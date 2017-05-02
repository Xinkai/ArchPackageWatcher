#!/usr/bin/node
"use strict";

const fs = require("fs");
const spawn = require("child_process").spawnSync;
const writeJsonFile = require('write-json-file');


class DataBase {
    constructor(filePath) {
        this.filePath = filePath;
        this.knownPackages = [];
        this.recentAddedPackages = Object.create(null); // repo/name: createTime
        this.recentRemovedPackages = Object.create(null); // repo/name: pkg

        if (fs.existsSync(filePath)) {
            const str = fs.readFileSync(filePath, { encoding: "utf-8" });
            const content = JSON.parse(str);
            this.load(content);
        }
    }

    load(content) {
        this.knownPackages = content.knownPackages;
        this.recentAddedPackages = content.recentAddedPackages;
        this.recentRemovedPackages = content.recentRemovedPackages;
    }

    save() {
        return writeJsonFile(this.filePath, {
            knownPackages: this.knownPackages,
            recentAddedPackages: this.recentAddedPackages,
            recentRemovedPackages: this.recentRemovedPackages,
        });
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
    return t1 < t2
};

const main = () => {
    {
        const result = spawn("/usr/bin/fakeroot",
            ["pacman", "-Sy", "--dbpath", "./", "--config", "./pacman.conf"],
            { encoding: "utf-8" , stdio: [0, 1, 2]});
        if (result.status !== 0) {
            console.error("Error occured during updating pacman db");
            process.exit(1);
        }
    }

    const timestamp = parseInt(Date.now() / 1000);

    const db = new DataBase("./database.json");

    const result = spawn(
        "/usr/bin/expac",
        ["--config", "./pacman.conf",
         "--timefmt", "%s",
         "-S", String.raw`%r\t%e\t%n\t%a\t%b\t%u\t%d\t%v`,
        ], { encoding: "utf-8" });

    const packagesArray = result.stdout.trim().split("\n").map(line => {
        const [repo, base, name, arch, time, url, desc, ver] = line.split("\t");
        return { repo, base: base === "(null)" ? null : base, name, arch, time: +time, url, desc, ver };
    });
    const packages = array2Object(packagesArray);

    const knownPackageIds = new Set(Object.keys(db.knownPackages));
    const packageIds = new Set(Object.keys(packages));

    const justRemovedSet = setMinus(knownPackageIds, packageIds);
    justRemovedSet.forEach(id => {
        db.recentRemovedPackages[id] = db.knownPackages[id];
        db.recentRemovedPackages[id].removeTime = timestamp;
    });
    for (let id of Object.keys(db.recentRemovedPackages)) {
        if (timeBefore(db.recentRemovedPackages[id].removeTime, timestamp - 3600 * 24 * 30)) {
            delete db.recentRemovedPackages[id];
        }
    }

    const justAddedSet = setMinus(packageIds, knownPackageIds);
    justAddedSet.forEach(id => {
        if (!(id in db.recentAddedPackages)) {
            db.recentAddedPackages[id] = timestamp;
        }
    });
    for (let id of Object.keys(db.recentAddedPackages)) {
        if (timeBefore(db.recentAddedPackages[id], timestamp - 3600 * 24 * 30) ||
            (!(id in packages))) {
            delete db.recentAddedPackages[id];
        }
    }

    db.knownPackages = packages;

    return db.save().then(() => {
        const output = {
            timestamp,
            "recentAddedPackages":
                Object.keys(db.recentAddedPackages)
                    .map(id => {
                        const r = packages[id];
                        r.createTime = db.recentAddedPackages[id];
                        return r;
                    })
                    .sort((pkg1, pkg2) => pkg2.createTime - pkg1.createTime),

            "recentRemovedPackages":
                Object.values(db.recentRemovedPackages)
                    .sort((pkg1, pkg2) => pkg2.removeTime - pkg1.removeTime),
        };
        return writeJsonFile("./output.json", output);
    });
};

main();
