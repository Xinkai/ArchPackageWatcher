#!/usr/bin/node
"use strict";

const fs = require("fs");
const spawn = require("child_process").spawnSync;
const writeJsonFile = require('write-json-file');


class DataBase {
    constructor(filePath) {
        this.filePath = filePath;
        this.knownPackages = [];
        this.recentAddedPackageIds = [];
        this.recentRemovedPackages = Object.create(null);

        if (fs.existsSync(filePath)) {
            const str = fs.readFileSync(filePath, { encoding: "utf-8" });
            const content = JSON.parse(str);
            this.load(content);
        }
    }

    load(content) {
        this.knownPackages = content.knownPackages;
        this.recentAddedPackageIds = content.recentAddedPackageIds;
        this.recentRemovedPackages = content.recentRemovedPackages;
    }

    save() {
        return writeJsonFile(this.filePath, {
            knownPackages: this.knownPackages,
            recentAddedPackageIds: this.recentAddedPackageIds,
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
        // repo/name makes an id
        o[`${pkg.repo}/${pkg.name}`] = pkg;
    }
    return o;
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
         "-S", String.raw`%r\t%n\t%a\t%b\t%u\t%d`,
        ], { encoding: "utf-8" });

    const packagesArray = result.stdout.trim().split("\n").map(line => {
        const [repo, name, arch, time, url, desc] = line.split("\t");
        return { repo, name, arch, time: +time, url, desc };
    });
    const packages = array2Object(packagesArray);

    const knownPackageIds = new Set(Object.keys(db.knownPackages));
    const packageIds = new Set(Object.keys(packages));

    const recentAddedSet = setMinus(packageIds, knownPackageIds);
    recentAddedSet.forEach(pkg => {
        if (!db.recentAddedPackageIds.includes(pkg)) {
            db.recentAddedPackageIds.push(pkg);
        }
    });
    db.recentAddedPackageIds = db.recentAddedPackageIds.filter(id =>
        packages[id].time >= timestamp - 3600 * 24 * 30
    );

    const recentRemovedSet = setMinus(knownPackageIds, packageIds);
    recentRemovedSet.forEach(id => {
        db.recentRemovedPackages[id] = db.knownPackages[id];
        db.recentRemovedPackages[id].removeTime = timestamp;
    });
    for (let id in db.recentRemovedPackages) {
        if (id.removeTime < timestamp - 3600 * 24 * 30) {
            delete db.recentRemovedPackages[id];
        }
    }
    db.knownPackages = packages;

    return db.save().then(() => {
        const output = {
            timestamp,
            "recentAddedPackages":
                db.recentAddedPackageIds
                    .map(id => packages[id])
                    .sort((pkg1, pkg2) => pkg2.time - pkg1.time),

            "recentRemovedPackages":
                Object.values(db.recentRemovedPackages)
                    .sort((pkg1, pkg2) => pkg2.removeTime - pkg1.removeTime),
        };
        return writeJsonFile("./output.json", output);
    });
};

main();
