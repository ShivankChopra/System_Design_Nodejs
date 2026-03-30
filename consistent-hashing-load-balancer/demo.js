const express = require("express");
const ConsistentLoadBalancer = require("./src/ConsistentLoadBalancer");

function createServer(serverId, port, lbPort) {
    const app = express();
    let isClosed = false;

    app.get("/hello", (req, res) => {
        const clientKey = req.headers["x-client-key"] || "";
        res.send(
            `Server ${serverId} running on port ${port} handled response for client ${clientKey}`,
        );
    });

    const server = app.listen(port, async () => {
        await fetch(`http://127.0.0.1:${lbPort}/__lb/register`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ serverId, addr: `127.0.0.1:${port}` }),
        });
        console.log(`Server ${serverId} running on ${port}`);
    });

    app.get("/kill-me", (req, res) => {
        res.send(`Server ${serverId} shutting down`);
        setTimeout(() => {
            if (isClosed) return;
            isClosed = true;
            server.close();
        }, 10);
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

async function main() {
    const lbPort = 4000;
    const lb = new ConsistentLoadBalancer(50);
    await lb.start(lbPort);
    console.log(`Load balancer running on ${lbPort}`);

    const servers = [
        createServer("server-A", 5001, lbPort),
        createServer("server-B", 5002, lbPort),
        createServer("server-C", 5003, lbPort),
        createServer("server-D", 5004, lbPort),
        createServer("server-e", 5005, lbPort),
        createServer("server-f", 5006, lbPort),
        createServer("server-g", 5007, lbPort),
        createServer("server-h", 5008, lbPort),
    ];

    const closeAll = async () => {
        for (const server of servers) {
            await server.close();
        }
        await lb.stop();
    };

    process.on("SIGINT", async () => {
        await closeAll();
        process.exit(0);
    });
}

main();
