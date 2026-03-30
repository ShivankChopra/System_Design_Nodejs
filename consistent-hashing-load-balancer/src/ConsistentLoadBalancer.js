const http = require("http");
const express = require("express");
const murmur = require("murmurhash");

class ConsistentLoadBalancer {
    constructor(virtualNodeCount = 50) {
        this.virtualNodeCount = virtualNodeCount;
        this.servers = new Map();
        this.nodes = new Map();
        this.ringNodeHashes = [];
        this.server = null;
    }

    hash(value) {
        return murmur.v3(String(value));
    }

    addServer(serverId, addr) {
        if (this.servers.has(serverId)) return false;
        const nodeHashes = [];
        for (let i = 0; i < this.virtualNodeCount; i += 1) {
            const nodeKey = `${serverId}#vn:${i}`;
            const nodeHash = this.hash(nodeKey);
            if (this.nodes.has(nodeHash)) {
                throw new Error(`Hash collision for ${nodeKey}`);
            }
            this.nodes.set(nodeHash, { nodeKey, nodeHash, serverId });
            nodeHashes.push(nodeHash);
            this.ringNodeHashes.push(nodeHash);
        }
        this.ringNodeHashes.sort((a, b) => a - b);
        this.servers.set(serverId, { nodeHashes, addr });
        return true;
    }

    removeServer(serverId) {
        const server = this.servers.get(serverId);
        if (!server) return false;
        for (const nodeHash of server.nodeHashes) {
            this.nodes.delete(nodeHash);
        }
        const toRemove = new Set(server.nodeHashes);
        this.ringNodeHashes = this.ringNodeHashes.filter(
            (hash) => !toRemove.has(hash),
        );
        this.servers.delete(serverId);
        return true;
    }

    findOwnerIndex(requestHash) {
        if (this.ringNodeHashes.length === 0) return -1;
        let left = 0;
        let right = this.ringNodeHashes.length - 1;
        let answer = -1;
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            if (this.ringNodeHashes[mid] >= requestHash) {
                answer = mid;
                right = mid - 1;
            } else {
                left = mid + 1;
            }
        }
        return answer === -1 ? 0 : answer;
    }

    nextIndex(index) {
        if (this.ringNodeHashes.length === 0) return -1;
        return index + 1 < this.ringNodeHashes.length ? index + 1 : 0;
    }

    proxyGet(req, res, addr) {
        return new Promise((resolve, reject) => {
            const [host, port] = addr.split(":");
            const proxyReq = http.request(
                {
                    host,
                    port: Number(port),
                    path: req.originalUrl,
                    method: req.method,
                    headers: req.headers,
                },
                (proxyRes) => {
                    res.status(proxyRes.statusCode || 200);
                    for (const [key, value] of Object.entries(proxyRes.headers)) {
                        if (value !== undefined) res.setHeader(key, value);
                    }
                    proxyRes.pipe(res);
                    proxyRes.on("end", resolve);
                    proxyRes.on("error", reject);
                },
            );
            proxyReq.setTimeout(1500, () => {
                proxyReq.destroy(new Error("timeout"));
            });
            proxyReq.on("error", reject);
            proxyReq.end();
        });
    }

    start(port) {
        const app = express();
        app.use(express.json());

        app.post("/__lb/register", (req, res) => {
            const isNew = this.addServer(req.body.serverId, req.body.addr);
            res.status(200).json({
                registered: isNew,
                serverId: req.body.serverId,
            });
        });

        app.get("*", async (req, res) => {
            if (this.ringNodeHashes.length === 0) {
                res.status(503).end();
                return;
            }
            const clientKey = req.headers["x-client-key"] || "";
            const requestHash = this.hash(clientKey);
            const triedServers = new Set();
            const maxServers = this.servers.size;
            let index = this.findOwnerIndex(requestHash);

            while (triedServers.size < maxServers && this.ringNodeHashes.length > 0) {
                const nodeHash = this.ringNodeHashes[index];
                const node = this.nodes.get(nodeHash);
                const serverId = node.serverId;

                if (triedServers.has(serverId)) {
                    index = this.nextIndex(index);
                    continue;
                }

                triedServers.add(serverId);
                const server = this.servers.get(serverId);

                try {
                    await this.proxyGet(req, res, server.addr);
                    return;
                } catch {
                    this.removeServer(serverId);
                    if (this.ringNodeHashes.length === 0) break;
                    if (index >= this.ringNodeHashes.length) index = 0;
                }
            }

            res.status(503).end();
        });

        return new Promise((resolve) => {
            this.server = app.listen(port, resolve);
        });
    }

    stop() {
        if (!this.server) return Promise.resolve();
        return new Promise((resolve) => {
            this.server.close(resolve);
        });
    }
}

module.exports = ConsistentLoadBalancer;
