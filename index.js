const express = require("express");
const { createServer } = require("node:http");
const { join } = require("node:path");
const { Server } = require("socket.io");
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { availableParallelism } = require('node:os');
const cluster = require('node:cluster');
const { createAdapter, setupPrimary } = require('@socket.io/cluster-adapter');
const path = require("path");

if(cluster.isPrimary) {
    const numCPUs = availableParallelism();

    for (let i=0;i<numCPUs;i++) {
        cluster.fork({
            PORT: 3000 + i
        });
    }

    return  setupPrimary();
}

async function main(){
    const db = await open({
        filename: 'chatss.db',
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_offset TEXT UNIQUE,
            content TEXT
        );
    `);

    const app = express();
    const server = createServer(app);
    const io = new Server(server, {
        connectionStateRecovery: {},
        adapter: createAdapter()
    });

    app.set("view engine", "ejs");
    app.set("views", path.join(__dirname, "views"));
    // app.engine("ejs", ejsMate);
    app.use(express.static(path.join(__dirname, "/public")));


    app.get("/", (req, res) => {
        res.render("chat.ejs");
    });

    io.on('connection', async (socket) => {
        socket.on('chat message', async (msg, clientOffset, callback) => {
            let result;
            try{
                result = await db.run('INSERT INTO messages (content, client_offset) VALUES (?, ?)', msg, clientOffset);
            } catch (e) {
                if(e.errno === 19){
                    callback();
                }else{

                }
                return;
            }
            io.emit('chat message', msg, result.lastID);

            callback();
        });

        if(!socket.recovered){
            try{
                await db.each('SELECT id, content FROM messages WHERE id > ?',
                    [socket.handshake.auth.serveroffset || 0],
                    (_err, row) => {
                        socket.emit('chat message', row.content, row.id);
                    }
                )
            } catch (e) {

            }
        }
    });

    const port = process.env.PORT;

    server.listen(port, () => {
        console.log(`server running at http://localhost:${port}`);
    });
}

main();