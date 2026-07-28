"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
try {
    const p4 = new client_1.PrismaClient({ datasource: { url: "file:./dev.db" } });
    console.log("p4 ok");
}
catch (e) {
    console.log("p4 failed:", e.message.split('\n')[0]);
}
try {
    const p5 = new client_1.PrismaClient({ db: { url: "file:./dev.db" } });
    console.log("p5 ok");
}
catch (e) {
    console.log("p5 failed:", e.message.split('\n')[0]);
}
try {
    const p6 = new client_1.PrismaClient({ url: "file:./dev.db" });
    console.log("p6 ok");
}
catch (e) {
    console.log("p6 failed:", e.message.split('\n')[0]);
}
//# sourceMappingURL=test2.js.map