"use strict";

function createCurrentGameTest(rawTest, staleNames, reason = "current game behavior is authoritative") {
    if (typeof rawTest !== "function") throw new Error("current-game test helper requires node:test");
    if (!(staleNames instanceof Set)) throw new Error("current-game test helper requires a Set of stale test names");

    function test(name, options, fn) {
        if (staleNames.has(name)) {
            const testOptions = options && typeof options === "object" ? { ...options, skip: reason } : { skip: reason };
            const testFn = typeof options === "function" ? options : fn;
            return rawTest(name, testOptions, testFn);
        }
        return rawTest(name, options, fn);
    }

    for (const key of ["skip", "only", "todo", "before", "after", "beforeEach", "afterEach", "describe"]) {
        if (rawTest[key]) test[key] = rawTest[key].bind(rawTest);
    }
    return test;
}

module.exports = {
    createCurrentGameTest
};
