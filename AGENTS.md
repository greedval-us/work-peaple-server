# Work People development environment

- Do not deploy or start the backend, PostgreSQL, or Redis on this Windows computer.
- Run backend services, Compose, database migrations, and server integration tests on `greed@192.168.0.102` over SSH (port 22).
- Prefer an existing user-owned key accepted by that server. The known candidate is `~/.ssh/id_ed25519_hostkey`; the user may supply another path. When the user authorizes password authentication, use an interactive SSH prompt and never persist credentials or copy private key contents into either repository or logs.
- Local source editing, static checks, and compilation are allowed. This computer runs only the desktop client as an application.
- Inspect the remote deployment directory and existing services before changes. Preserve unrelated server workloads and persistent volumes.
- Current deployment: `/home/greed/apps/work-people-server`, Compose project `workpeople`. Docker access requires `sudo`; keep the existing private `.env` when updating sources. Run container checks with `sudo docker build --target verify -t workpeople-server:verified .`.
- Keep Compose gRPC bound to remote loopback and PostgreSQL/Redis internal. Use SSH forwarding for desktop development.
- `proto/workpeople/v1` in this repository is the canonical gRPC contract. Coordinate compatible changes with the separate client repository.
