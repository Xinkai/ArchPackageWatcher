#!/usr/bin/node
"use strict";

const fs = require("fs");
const os = require("os");
const spawn = require("child_process").spawnSync;
const writeJsonFile = require('write-json-file');
const chalk = require("chalk");


const readJson = filePath => {
    let str = "";
    let result = null;
    try {
        str = fs.readFileSync(filePath, { encoding: "utf-8" });
    } catch (e) {
        return ["Failed to read", result];
    }
    try {
        result = JSON.parse(str);
    } catch (e) {
        return ["Failed to parse", result];
    }
    return [null, result];

};


class DataBase {
    constructor(filePath) {
        this.filePath = filePath;
        this.packages = [];
        this.recentAddedPackages = Object.create(null); // repo/name: createTime
        this.recentRemovedPackages = Object.create(null); // repo/name: pkg
        this.timestamp = parseInt(Date.now() / 1000);

        const [error, content] = readJson(filePath);
        if (!error) {
            this.load(content);
        }
    }

    dismiss() {
        this.recentAddedPackages = Object.create(null);
        this.recentRemovedPackages = Object.create(null);
    }

    load(content) {
        this.packages = content.packages;
        this.recentAddedPackages = content.recentAddedPackages;
        this.recentRemovedPackages = content.recentRemovedPackages;
    }

    save() {
        return writeJsonFile(this.filePath, {
            packages: this.packages,
            recentAddedPackages: this.recentAddedPackages,
            recentRemovedPackages: this.recentRemovedPackages,
            timestamp: this.timestamp,
        });
    }

    exportResult() {
        return {
            "timestamp": this.timestamp,
            "recentAddedPackages": Object.keys(this.recentAddedPackages)
                .map(id => {
                    const r = this.packages[id];
                    r.createTime = this.recentAddedPackages[id].createTime;
                    return r;
                })
                .sort((pkg1, pkg2) => pkg2.createTime - pkg1.createTime),
            "recentRemovedPackages": Object.values(this.recentRemovedPackages)
                .sort((pkg1, pkg2) => pkg2.removeTime - pkg1.removeTime),
        };
    }
}


const setMinus = (s1, s2) => {
    if (s1.__proto__ !== Set.prototype) {
        throw new Error(`s1 is not a set`);
    }
    if (s2.__proto__ !== Set.prototype) {
        throw new Error(`s2 is not a set`);
    }
    const s = new Set(s1);
    for (let one of s2) {
        s.delete(one);
    }
    return s;
};


const array2Object = arr => {
    const o = Object.create(null);
    for (let pkg of arr) {
        if (!(pkg.repo && pkg.name)) {
            throw new Error(`${JSON.stringify(pkg)} is not a package`);
        }
        // repo/name makes an id
        o[`${pkg.repo}/${pkg.name}`] = pkg;
    }
    return o;
};


const timeBefore = (t1, t2) => {
    if (typeof t1 !== "number") {
        throw new Error(`${t1} is not number`);
    }
    if (typeof t2 !== "number") {
        throw new Error(`${t2} is not number`);
    }
    return t1 < t2;
};


const processChanges = (db, pacmanConfPath) => {
    const result = spawn(
        "/usr/bin/expac",
        ["--config", pacmanConfPath,
         "--timefmt", "%s",
         "-S", String.raw`%r\t%e\t%n\t%a\t%b\t%u\t%d\t%v`,
        ], { encoding: "utf-8" });

    const packagesArray = result.stdout.trim().split("\n").map(line => {
        const [repo, base, name, arch, time, url, desc, ver] = line.split("\t");
        return { repo, base: base === "(null)" ? null : base, name, arch, time: +time, url, desc, ver };
    });
    const packages = array2Object(packagesArray);

    const knownPackageIds = new Set(Object.keys(db.packages));
    const packageIds = new Set(Object.keys(packages));

    const justRemovedSet = setMinus(knownPackageIds, packageIds);
    justRemovedSet.forEach(id => {
        db.recentRemovedPackages[id] = db.packages[id];
        db.recentRemovedPackages[id].removeTime = db.timestamp;
    });

    for (let id of Object.keys(db.recentRemovedPackages)) {
        if (timeBefore(db.recentRemovedPackages[id].removeTime, db.timestamp - 3600 * 24 * 30)) {
            delete db.recentRemovedPackages[id];
        }
    }

    const justAddedSet = setMinus(packageIds, knownPackageIds);
    justAddedSet.forEach(id => {
        if (!(id in db.recentAddedPackages)) {
            db.recentAddedPackages[id] = {
                createTime: db.timestamp,
            };
        }
    });
    for (let id of Object.keys(db.recentAddedPackages)) {
        if (timeBefore(db.recentAddedPackages[id].createTime, db.timestamp - 3600 * 24 * 30) ||
            (!(id in packages))) {
            delete db.recentAddedPackages[id];
        }
    }

    db.packages = packages;

    return db.save().then(() => db);
};

let config = "/etc/pacman.conf";
let command = "";
const parseArguments = () => {
    let args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--config") {
            config = args[i+1];
            i += 1;
        } else {
            if (!command) {
                command = args[i];
            } else {
                help();
                process.exit(1);
            }
        }
    }
    if (command === "") {
        command = "show";
    }
};


const getDataBasePath = () => `${os.homedir()}/.cache/apw.json`;
const getResultPath = () => `${os.homedir()}/.cache/apw-result.json`;


const help = () => {
    console.log(`Usage: apw [options] [command] 

Track Arch Linux repo changes: what packages recently entered/left repos

Commands:
    init                Initialize apw
    
    clean               Clean user data

    dismiss             Dismiss current changes

    update              Update apw database from local pacman database

    help                Show this help

    show [default]      Show recent changes

Options:
    --config FILE       [default=/etc/pacman.conf]
                        Use alternative pacman.conf
                        
Note:
    apw is not retroactive. For a list of recent changes before you installed apw, go to https://tokyo.cuoan.net/apw/output.json`);
};


const output = result => {
    const buffer = [];

    for (let pkg of result.recentAddedPackages) {
        buffer.push(
            chalk.bold.magenta(`${pkg.repo}/`) +
            chalk.bold.white(`${pkg.name} `) +
            chalk.bold.green(`${pkg.ver}\n`) +
            `    ${pkg.desc}\n` +
            chalk.blue(`    ${pkg.url}`)
        );
    }

    for (let pkg of result.recentRemovedPackages) {
        buffer.push(
            chalk.bold.strikethrough.magenta(`${pkg.repo}/`) +
            chalk.bold.strikethrough.white(`${pkg.name} `) +
            chalk.bold.strikethrough.green(`${pkg.ver}\n`) +
            `    ${pkg.desc}\n` +
            chalk.blue(`    ${pkg.url}`)
        );
    }

    if (buffer.length) {
        console.log(`Detected the following repo changes. Use ${chalk.underline("apw dismiss")} to dismiss them.`);
        console.log(buffer.join("\n"));
    }
};


const tryUnlink = filePath => {
    try {
        fs.unlinkSync(filePath);
    } catch (e) {
        if (e.code !== "ENOENT") {
            throw e;
        }
    }
};

const cmdClean = () => {
    console.log(chalk.bold("Stop systemd user timer"));
    spawn("systemctl", ["--user", "stop", "apw.timer"],
        { encoding: "utf-8", stdio: [0, 1, 2] });

    console.log(chalk.bold("Remove ~/.cache/apw.json"));
    tryUnlink(getDataBasePath());

    console.log(chalk.bold("Remove ~/.cache/apw-result.json"));
    tryUnlink(getResultPath());
};


const cmdInit = async () => {
    console.log(chalk.bold("Call 'apw update' for the first time"));
    const db = await cmdUpdate(config);

    console.log(chalk.bold("Call 'apw dismiss' for the first time"));
    await cmdDismiss(db);

    console.log(chalk.bold("Start systemd user timer"));
    spawn("systemctl", ["--user", "start", "apw.timer"],
        { encoding: "utf-8", stdio: [0, 1, 2] });
};


const cmdUpdate = (config) => {
    const db = new DataBase(getDataBasePath());
    return processChanges(db, config)
        .then(db => writeJsonFile(getResultPath(), db.exportResult()))
        .then(() => db);
};


const cmdDismiss = (db_ = null) => {
    const db = db_ ? db_ : new DataBase(getDataBasePath());
    db.dismiss();
    return Promise.all([
        writeJsonFile(getResultPath(), db.exportResult()),
        db.save(),
    ]);
};


const cmdShow = () => {
    const [error, content] = readJson(getResultPath());
    if (!error) {
        output(content);
    } else {
        console.error("Did you forget to call 'apw init'?");
        return process.exit(1);
    }
};


const main = () => {
    parseArguments();

    switch (command) {
        case "init": {
            cmdInit();
            break;
        }

        case "clean": {
            cmdClean();
            break;
        }

        case "dismiss": {
            cmdDismiss();
            break;
        }

        case "update": {
            cmdUpdate(config);
            break;
        }

        case "help": {
            help();
            break;
        }

        case "show": {
            cmdShow();
            break;
        }

        default: {
            help();
            process.exit(1);
        }
    }
};


main();
