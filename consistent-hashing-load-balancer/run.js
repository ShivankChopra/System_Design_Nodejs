const express = require("express");
const ConsistentLoadBalancer = require("./src/ConsistentLoadBalancer");

function createServer(serverId, port, lbPort) {
    const app = express();
    let isClosed = false;

    app.get("/hello", (req, res) => {
        const clientKey = req.headers["x-client-key"] || "";
        res.send(`${serverId} handled key ${clientKey}`);
    });

    const server = app.listen(port, async () => {
        await fetch(`http://127.0.0.1:${lbPort}/__lb/register`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ serverId, addr: `127.0.0.1:${port}` }),
        });
    });

    return {
        serverId,
        close: () =>
            new Promise((resolve) => {
                if (isClosed) {
                    resolve();
                    return;
                }
                isClosed = true;
                server.close(resolve);
            }),
    };
}

function createClient(clientKey, lbPort) {
    return {
        request: async (path = "/hello") => {
            const response = await fetch(`http://127.0.0.1:${lbPort}${path}`, {
                method: "GET",
                headers: { "x-client-key": clientKey },
            });
            return response.text();
        },
        requestRaw: async (path = "/hello") => {
            const response = await fetch(`http://127.0.0.1:${lbPort}${path}`, {
                method: "GET",
                headers: { "x-client-key": clientKey },
            });
            return {
                status: response.status,
                text: await response.text(),
            };
        },
    };
}

function getServerIdFromResponse(text) {
    return text.split(" handled key ")[0];
}

async function scenarioStableMapping(lbPort) {
    const keys = ["client-1", "client-2", "client-3", "client-4", "client-5"];
    const result = {};
    for (const key of keys) {
        const client = createClient(key, lbPort);
        result[key] = [];
        for (let i = 0; i < 5; i += 1) {
            const text = await client.request("/hello");
            result[key].push(getServerIdFromResponse(text));
        }
    }
    console.log("Scenario A: Stable Mapping");
    console.log(JSON.stringify(result, null, 4));
}

async function scenarioDistribution(lbPort) {
    const counts = {};
    for (let i = 0; i < 100; i += 1) {
        const key = `client-${i}`;
        const client = createClient(key, lbPort);
        const text = await client.request("/hello");
        const serverId = getServerIdFromResponse(text);
        counts[serverId] = (counts[serverId] || 0) + 1;
    }
    console.log("Scenario B: Distribution");
    console.log(JSON.stringify(counts, null, 4));
}

async function buildSnapshot(keys, lbPort) {
    const snapshot = {};
    for (const key of keys) {
        const client = createClient(key, lbPort);
        const text = await client.request("/hello");
        snapshot[key] = getServerIdFromResponse(text);
    }
    return snapshot;
}

function countRemaps(before, after) {
    let changedKeys = 0;
    for (const key of Object.keys(before)) {
        if (before[key] !== after[key]) changedKeys += 1;
    }
    return changedKeys;
}

async function scenarioRemoveServer(lbPort, serverToClose) {
    const keys = Array.from({ length: 100 }, (_, i) => `client-${i}`);
    const snapshotBefore = await buildSnapshot(keys, lbPort);
    await serverToClose.close();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const snapshotAfter = await buildSnapshot(keys, lbPort);
    console.log("Scenario C: Remove One Server");
    console.log(
        JSON.stringify(
            {
                removedServer: serverToClose.serverId,
                changedKeys: countRemaps(snapshotBefore, snapshotAfter),
                totalKeys: keys.length,
            },
            null,
            4,
        ),
    );
}

async function scenarioAddServer(lbPort, servers) {
    const keys = Array.from({ length: 100 }, (_, i) => `client-${i}`);
    const snapshotBefore = await buildSnapshot(keys, lbPort);
    const addedServer = createServer("server-E", 4005, lbPort);
    servers.push(addedServer);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const snapshotAfter = await buildSnapshot(keys, lbPort);
    console.log("Scenario D: Add One Server");
    console.log(
        JSON.stringify(
            {
                addedServer: addedServer.serverId,
                changedKeys: countRemaps(snapshotBefore, snapshotAfter),
                totalKeys: keys.length,
            },
            null,
            4,
        ),
    );
}

async function scenarioAllServersDown(lbPort, servers) {
    for (const server of servers) {
        await server.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    const client = createClient("client-all-down", lbPort);
    const response = await client.requestRaw("/hello");
    console.log("Scenario E: All Servers Down");
    console.log(
        JSON.stringify(
            {
                status: response.status,
                body: response.text,
            },
            null,
            4,
        ),
    );
}

async function main() {
    const lbPort = 4000;
    const lb = new ConsistentLoadBalancer(50);
    await lb.start(lbPort);

    const serverA = createServer("server-A", 4001, lbPort);
    const serverB = createServer("server-B", 4002, lbPort);
    const serverC = createServer("server-C", 4003, lbPort);
    const serverD = createServer("server-D", 4004, lbPort);
    const servers = [serverA, serverB, serverC, serverD];

    await new Promise((resolve) => setTimeout(resolve, 300));
    await scenarioStableMapping(lbPort);
    await scenarioDistribution(lbPort);
    await scenarioRemoveServer(lbPort, serverB);
    await scenarioAddServer(lbPort, servers);
    await scenarioAllServersDown(lbPort, servers);

    const closeServers = async () => {
        for (const server of servers) {
            await server.close();
        }
        await lb.stop();
    };

    process.on("SIGINT", async () => {
        await closeServers();
        process.exit(0);
    });

    await closeServers();
}

main();
