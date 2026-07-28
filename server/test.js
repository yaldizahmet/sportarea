"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
try {
    const p1 = new client_1.PrismaClient();
    console.log("p1 ok");
}
catch (e) {
    console.log("p1 failed:", e.message.split('\n')[0]);
}
try {
    const p2 = new client_1.PrismaClient({ datasources: { db: { url: "file:./dev.db" } } });
    console.log("p2 ok");
}
catch (e) {
    console.log("p2 failed:", e.message.split('\n')[0]);
}
try {
    const p3 = new client_1.PrismaClient({ datasourceUrl: "file:./dev.db" });
    console.log("p3 ok");
}
catch (e) {
    console.log("p3 failed:", e.message.split('\n')[0]);
}
//# sourceMappingURL=test.js.map