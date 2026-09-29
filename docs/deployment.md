# Deploying Wreckyard

One Node process serves the game page, the WebSocket (`/ws`) and `/healthz`. Rooms live in that process's memory, so **run exactly one instance**: a second one would split the players into separate worlds. There is no database and nothing to back up.

## With Docker

```bash
docker build -t wreckyard .
docker run -d --name wreckyard --restart unless-stopped -p 127.0.0.1:8080:8080 -e TRUST_PROXY=1 wreckyard
```

The image holds only the built bundle (`dist/`), runs as the `node` user and has a health check on `/healthz`; `docker ps` should show `healthy` after a few seconds. Binding to `127.0.0.1` means only your reverse proxy can reach it. (The image was written and tested without a Docker daemon: if the first build or run misbehaves, that is the first thing to look at.)

## Without Docker

```bash
npm ci && npm run build
PORT=8080 TRUST_PROXY=1 node dist/server/index.js
```

Node 22.12 or newer (the image uses 24). Run it under a supervisor (systemd, pm2). At run time only `dist/server` and `dist/client` are needed, with the working directory holding `dist/`.

## HTTPS in front of it

Browsers need `https://`; the page then opens `wss://` on the same host by itself. Your reverse proxy terminates TLS and must **pass WebSocket upgrades**, **keep the `Host` header** (the server refuses a WebSocket whose `Origin` is not its own host unless `ALLOWED_ORIGINS` lists it) and **append the client's address to `X-Forwarded-For`**.

Caddy (HTTPS is automatic):

```
play.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

nginx (the TLS part is not shown):

```
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Set **`TRUST_PROXY` to the number of proxies in front that append to `X-Forwarded-For`** (usually `1`). Left at 0 behind a load balancer with a public address, every player shares one address and the whole game is capped at 16 sockets; set with no appending proxy, a client can write its own address. The README's "Limits, hosting and Docker" section has the details. On a platform that runs its own load balancer (WebSocket support is required, one instance only), the port comes from `PORT` and the balancer is your proxy.

## Settings

| Variable | Default | What it does |
|---|---|---|
| `PORT` | 8080 | the port the server listens on |
| `TRUST_PROXY` | 0 | how many reverse proxies stand in front (see above) |
| `ALLOWED_ORIGINS` | same host only | exact origins allowed to open the WebSocket, comma-separated; needed only if the page is served from a different host than the socket |
| `MAX_ROOMS` | 12 | rooms at once; beyond that players are told the server is full |
| `MAX_CONNECTIONS` | 200 | sockets at once |
| `MAX_CONNECTIONS_PER_IP` | 16 | sockets per public address (0 = no limit) |
| `BOT_FILL` | 4 | bots fill a room up to this many cars (0 = none) |
| `COUNTDOWN_SECONDS`, `ROUND_SECONDS`, `RESULTS_SECONDS` | 5, 240, 8 | round timing |

The README lists the rest.

## Check it

- `curl https://play.example.com/healthz` answers JSON with `rooms`, `players`, `connections`, `tickMsP99` and the process memory.
- Open two browsers, choose Quick Play in both: they land in the same room. With `TRUST_PROXY` right, `connections` in `/healthz` matches the players you have connected.
- To see how many rooms the machine holds, run the load test **on the server itself** (the per-address limits apply to public addresses, so a test over the internet is limited to 6 new rooms a minute): start a server with `MAX_CONNECTIONS_PER_IP=0 BOT_FILL=0` on another port and `npm run loadtest -- --url ws://127.0.0.1:<port>/ws --rooms 4 --per-room 8 --seconds 60`, raising `--rooms` until the numbers stop looking good. On the 10-core laptop it was measured on, ten full rooms used about a fifth of one core and 80-115 MB of memory; the design figure for bandwidth is about 10 KB/s per player.

## Updating

Build the new image, stop the old container, start the new one with the same `docker run` line. Players in the middle of a round are dropped and reconnect through the menu; nothing is stored.
