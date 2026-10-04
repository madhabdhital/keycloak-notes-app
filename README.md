# Keycloak Notes App

A small Notes application that implements Keycloak authentication end to end: login, JWT access tokens, backend token validation, protected APIs, role-based authorization, and logout.

The notes themselves are not the point. They exist so there is something worth protecting. A normal user can create, view and delete their own notes. An admin can additionally see every user's notes and delete any of them.

Repository: `https://github.com/<your-username>/keycloak-notes-app`

---

## 1. What I built

| Part | Technology | Port |
|------|------------|------|
| Identity server | Keycloak 26 (Docker) | 8090 |
| Backend API | Spring Boot 3 (Java 17), Spring Security OAuth2 Resource Server, Spring Data JPA | 8080 |
| Database | MySQL 8.4 (Docker) | 3307 |
| Frontend | React (Vite) with `keycloak-js` | 5173 |

Project layout:

```
keycloak-notes-app/
  docker-compose.yml      Keycloak and MySQL
  keycloak/
    notes-realm.json      exported realm, imported automatically on startup
  backend/                Spring Boot project
  frontend/               React project
  README.md
```

Users and roles:

| User | Password | Roles |
|------|----------|-------|
| alice | alice123 | user |
| madhabdhital78 | Madhab@2003 | user, admin |

These are development-only credentials. The Keycloak admin console login is `admin` / `admin`.

---

## 2. Why I made these technical choices

**Keycloak as the identity server.** My application never sees or stores a password. Keycloak shows the login page, checks credentials, and issues signed tokens. The application only has to verify tokens, which is both simpler and safer than building authentication myself.

**Authorization Code flow with PKCE for the React app.** A React app runs in the user's browser, so it cannot keep a secret. That makes it a "public client". The standard secure flow for public clients is Authorization Code with PKCE. The older "implicit" flow and the "direct password" flow are avoided on purpose, since the first exposes tokens in the URL and the second makes my app handle passwords.

**Spring Boot as a stateless resource server.** The backend keeps no login session. Every request carries its own proof of identity in a JWT, and the backend verifies it. Spring Security's OAuth2 Resource Server support does the signature, issuer and expiry checks from a single configuration property.

**JWT validation with Keycloak's public keys.** The backend does not call Keycloak for every request. It downloads Keycloak's public signing keys once and verifies each token locally, which is fast and means the API keeps working with no per-request dependency on Keycloak.

**MySQL for application data only.** MySQL stores notes. User identity data lives in Keycloak, and a note only stores the owner's Keycloak user ID (the token's `sub` claim) and username.

**keycloak-js on the frontend.** It handles the redirect to Keycloak, the PKCE challenge, the code-for-token exchange, token refresh and logout, so I do not hand-write security-sensitive code.

**Realm exported to JSON.** The realm configuration is committed to the repository and imported automatically, so anyone who clones the repo gets the same realm, client, roles and users without clicking through the admin console.

---

## 3. How Keycloak is configured

Everything lives in the realm `notes-realm`. I did not use the built-in `master` realm, which is only for administering Keycloak itself.

**Client `notes-frontend`**

- Protocol: OpenID Connect.
- Client authentication: **off**. It is a public client, because browser code cannot hold a secret.
- Standard flow: **on** (this is the Authorization Code flow).
- Direct access grants: **off**, so the app can never exchange a username and password for a token directly.
- PKCE method: **S256**, set in the client's Advanced settings.
- Valid redirect URIs: `http://localhost:5173/*`. Keycloak only sends the user back to addresses on this allow-list.
- Valid post-logout redirect URIs: `http://localhost:5173/*`.
- Web origins: `http://localhost:5173`.

**Realm roles:** `user` and `admin`.

**Users:** `alice` (role `user`) and `bob` (roles `user` and `admin`). Both have complete profiles (email, first and last name) and non-temporary passwords. Keycloak 26 can refuse to log in a user whose profile is incomplete.

**Realm roles in the token.** Keycloak places realm roles in the access token under `realm_access.roles`. The backend reads them from there.

**Import on startup.** `docker-compose.yml` starts Keycloak with `start-dev --import-realm` and mounts `./keycloak` into `/opt/keycloak/data/import`. On startup Keycloak creates `notes-realm` from `notes-realm.json` if it does not already exist. The user passwords in that file are stored as hashes, never as plain text.

**Development mode.** `start-dev` uses plain HTTP and an embedded database. That is fine for an assignment and wrong for production, which needs HTTPS, an external database, and a hostname configuration.

---

## 4. The complete authentication flow

1. The user opens the React app at `http://localhost:5173`. `keycloak-js` runs `init` with `check-sso` and finds the user is not logged in, so the app shows a login screen.
2. The user clicks **Login**. `keycloak-js` generates a random `code_verifier`, hashes it into a `code_challenge` (S256), and redirects the browser to Keycloak's authorization endpoint with the client ID, the redirect URI and the challenge.
3. Keycloak shows its own login page. The user types the username and password **into Keycloak**, never into my app.
4. Keycloak checks the credentials, creates an SSO session, and redirects the browser back to `http://localhost:5173` with a short-lived, one-time **authorization code** in the URL.
5. `keycloak-js` sends that code plus the original `code_verifier` to Keycloak's token endpoint. Keycloak hashes the verifier and compares it with the challenge from step 2. Only the party that started the login can complete it, so a stolen code is useless to an attacker.
6. Keycloak returns an **access token** (a JWT), a **refresh token**, and an ID token. `keycloak-js` keeps them in memory, not in `localStorage`.
7. For every API call, the frontend sends `Authorization: Bearer <access token>` to the Spring Boot backend.
8. The backend validates the token (section 5), derives the user's roles from it, applies the access rules (section 6), and either runs the request or rejects it.
9. Before each call the frontend runs `updateToken(30)`. If the access token expires within 30 seconds, `keycloak-js` silently uses the refresh token to get a new one.
10. On **Logout**, `keycloak-js` redirects to Keycloak's logout endpoint, which ends the Keycloak SSO session, and then returns to the app, which shows the login screen again.

---

## 5. How JWTs are issued, passed and validated

**Issued.** Keycloak creates the access token after a successful login and signs it with its private key (RS256). A JWT has three Base64URL parts separated by dots: a header (the algorithm and key ID), a payload of claims, and a signature. The payload and header are encoded, not encrypted, so anyone holding the token can read them. The signature stops anyone from changing them. The app has a "Show decoded token" button so the claims can be inspected.

Important claims in the access token:

| Claim | Meaning |
|-------|---------|
| `iss` | Issuer, `http://localhost:8090/realms/notes-realm` |
| `sub` | Stable unique ID of the user, used as the note owner ID |
| `preferred_username` | Login name, for example `alice` |
| `exp` / `iat` | Expiry and issued-at time |
| `realm_access.roles` | The user's realm roles, for example `["user", "admin"]` |

**Passed.** In the `Authorization: Bearer ...` HTTP header on every API request. It is not put in the URL or in a cookie.

**Validated.** The only security setting needed in `application.properties` is:

```
spring.security.oauth2.resourceserver.jwt.issuer-uri=http://localhost:8090/realms/notes-realm
```

At startup Spring contacts that URL, reads the OpenID discovery document (`/.well-known/openid-configuration`), finds the `jwks_uri`, and downloads Keycloak's public keys. For every request it then checks that:

1. the token is well formed and the **signature** verifies against Keycloak's public key (the key is chosen using the `kid` in the token header),
2. the **issuer** (`iss`) matches the configured issuer,
3. the token has **not expired** (`exp`, `nbf`).

If any check fails the backend answers **401 Unauthorized**. Because keys are fetched at startup, Keycloak must be running before the backend starts.

---

## 6. How authorization and roles work

Authentication answers "who are you". Authorization answers "what may you do". The two outcomes are kept apart on purpose:

- **401 Unauthorized**: no token, or an invalid or expired token. The backend does not know who the caller is.
- **403 Forbidden**: a valid token, but the user's role does not allow this action.

**Role mapping.** Spring does not look in `realm_access.roles` by default. `SecurityConfig` contains a custom `JwtAuthenticationConverter` that reads each role from that claim and creates a Spring authority named `ROLE_<role>`, for example `ROLE_admin`. This is what lets `hasRole("admin")` work.

**Access rules** (`SecurityConfig.java`), evaluated in order:

| Path | Rule |
|------|------|
| `/api/public/**` | open to everyone |
| `/api/admin/**` | role `admin` only |
| `/api/**` (everything else) | role `user` or `admin` |
| anything else | denied |

The order matters. Spring uses the first matching rule, so the more specific `/api/admin/**` rule must come before the general `/api/**` rule. The final `denyAll` means any path I forget to list is closed by default.

**Endpoints**

| Method and path | Who | What it does |
|-----------------|-----|--------------|
| GET `/api/public/hello` | anyone | public test endpoint |
| GET `/api/me` | any logged-in user | returns username, user ID and roles read from the token |
| GET `/api/notes` | user, admin | the caller's own notes |
| POST `/api/notes` | user, admin | create a note owned by the caller |
| DELETE `/api/notes/{id}` | user, admin | delete a note, only if the caller owns it, otherwise 403 |
| GET `/api/admin/notes` | admin | all users' notes |
| DELETE `/api/admin/notes/{id}` | admin | delete any note |

**Ownership.** The controller never trusts an owner ID sent by the client. It always takes the identity from the validated token (`jwt.getSubject()`). A user therefore cannot create notes for someone else or read another user's notes through `/api/notes`.

**The frontend only hides things.** The React app shows the admin section only if the token contains the `admin` role. That is a convenience. The real protection is the backend returning 403 for non-admins, because anyone can call the API directly without the UI.

---

## 7. Important implementation details

- **Stateless API.** Session creation policy is `STATELESS`, so the backend stores no sessions.
- **CSRF disabled.** CSRF attacks rely on the browser automatically attaching cookies. This API authenticates with a bearer header that the browser does not attach by itself, so CSRF protection is not needed here.
- **CORS.** The frontend (port 5173) and backend (port 8080) are different origins, so the browser enforces CORS. The backend allows only `http://localhost:5173`, with the `Authorization` and `Content-Type` headers and the methods GET, POST, DELETE and OPTIONS.
- **Tokens held in memory.** `keycloak-js` keeps tokens in JavaScript memory, so they are not readable from `localStorage`, and a page refresh restores the session through Keycloak's SSO cookie (`check-sso`).
- **Token refresh.** `updateToken(30)` runs before each API call.
- **`checkLoginIframe: false`.** This disables the hidden iframe that polls Keycloak for session changes. It avoids a known source of problems in modern browsers and keeps the setup simple.
- **JPA.** `spring.jpa.hibernate.ddl-auto=update` lets Hibernate create the `note` table automatically. That is convenient for development, while production would use migrations.
- **Logout and the access token.** Logout ends the Keycloak session, so the refresh token stops working. An access token that was already issued is a self-contained JWT and stays technically valid until its `exp` time (short-lived, five minutes by default in Keycloak). This is a known property of stateless JWT validation. Short token lifetimes are the mitigation.
- **Known limitations.** The backend checks signature, issuer and expiry but does not check the token audience. Passwords in the compose file and properties file are development values and would come from environment variables or a secrets manager in a real deployment. HTTPS is not used in development.

---

## 8. How to run the project

**Prerequisites:** Docker Desktop, JDK 17 or newer, Node.js (LTS) and npm, Git. Maven is not needed because the project includes the Maven Wrapper.

**1. Clone the repository**

```
git clone https://github.com/<your-username>/keycloak-notes-app.git
cd keycloak-notes-app
```

**2. Start Keycloak and MySQL**

```
docker compose up -d
```

Wait about a minute for Keycloak to start and import the realm. Check it by opening `http://localhost:8090/realms/notes-realm/.well-known/openid-configuration`, which should return JSON. The Keycloak admin console is at `http://localhost:8090` (`admin` / `admin`).

**3. Start the backend** (new terminal; start it after Keycloak is up)

```
cd backend
.\mvnw.cmd spring-boot:run        # Windows
./mvnw spring-boot:run            # macOS / Linux
```

It listens on `http://localhost:8080`.

**4. Start the frontend** (new terminal)

```
cd frontend
npm install
npm run dev -- --port 5173 --strictPort
```

Port 5173 is fixed because it is the only origin registered in Keycloak and allowed by CORS.

**5. Use it.** Open `http://localhost:5173` and log in as `alice` / `alice123` or `bob` / `bob123`.

**Stopping.** `docker compose down` stops the containers and keeps the data. `docker compose down -v` also deletes the volumes, which resets Keycloak (it is re-imported from `notes-realm.json`) and empties the notes.

---

## 9. How I tested it

All tests were done manually in the browser, with the database checked directly.

| # | Test | Expected | Result |
|---|------|----------|--------|
| 1 | Open `/api/public/hello` with no token | 200 and a JSON message | Passed |
| 2 | Open `/api/notes` with no token | 401 | Passed |
| 3 | Log in as alice through Keycloak | Redirect to Keycloak, then back to the app, roles line shows `user` | Passed |
| 4 | Alice calls `/api/me` through the app | Returns her username, user ID and `ROLE_user` | Passed |
| 5 | Alice adds notes | Notes appear in her list and in the `note` table with `owner_username = alice` | Passed |
| 6 | Alice calls `/api/admin/notes` | 403 | Passed |
| 7 | Alice's page has no admin section | Admin card not shown | Passed |
| 8 | Log in as bob | Roles `user` and `admin`, yellow admin badge | Passed |
| 9 | Bob's "My notes" | Empty, because notes belong to their owner | Passed |
| 10 | Bob's admin list | Shows alice's notes | Passed |
| 11 | Bob deletes alice's note from the admin list | Note disappears, row removed from the database | Passed |
| 12 | Logout | Returns to the login screen, protected calls need a new login | Passed |
| 13 | Fresh start: `docker compose down -v`, then `up -d` | Realm, client, roles and both users are recreated from `notes-realm.json`, logins work | Passed |

To inspect the stored data:

```
docker exec -it notes-mysql mysql -unotesuser -pnotespass notesdb -e "select id, owner_username, content from note;"
```

---

## 10. Problems I encountered and how I solved them

**`mvn` is not recognized.** Maven was not installed. The Spring Initializr project includes the Maven Wrapper (`mvnw` / `mvnw.cmd`), which downloads the right Maven version itself, so I used that instead of installing Maven globally.

**Port conflicts.** MySQL was already running on my machine on 3306, and 8080 is needed by the backend. I changed only the left (host) side of the port mappings in `docker-compose.yml`: Keycloak on 8090 and MySQL on 3307. The container ports stay 8080 and 3306. I then updated every dependent URL (Keycloak URL in the frontend, issuer URI and JDBC URL in the backend).

**Could not assign the `user` and `admin` roles to a user.** The "Assign role" dialog listed `account`, `broker` and `realm-management` roles. Those are client roles from Keycloak's built-in clients, which the dialog shows by default. I switched the dialog's filter to "Filter by realm roles", where my roles were listed.

**The backend returned 401 in the browser right after setup.** This was correct behavior, not a bug. Spring Security denies everything by default until rules are configured. After adding `SecurityConfig`, the public endpoint opened and protected ones still returned 401 without a token.

**`Note cannot be resolved to a type` and a compile failure.** I ran `.\mvnw.cmd compile`, whose output said `duplicate class: SecurityConfig` and pointed at `Note.java`. When creating the files I had pasted the `SecurityConfig` code into `Note.java`, so two files declared `SecurityConfig` and no file declared `Note`. I replaced the content of `Note.java` with the entity class. The lesson is that each file should hold the class matching its name, and that the Maven error output is more reliable than the editor's underlines.

**`.\mvnw.cmd` not recognized.** The terminal was in the project root instead of the `backend` folder. The wrapper script is in `backend`, so I had to `cd backend` first.

**Alice's notes did not appear in the admin list.** The database held the rows, so the backend was fine. The cause was in React: `isAdmin` was calculated during the first render, before Keycloak had finished logging in, when no token existed, so it was `false`. The `loadNotes` function created in that render kept that stale value (a stale closure) and never fetched the admin list. I fixed it by reading the roles from `keycloak.tokenParsed` inside `loadNotes` at the moment it runs.

**The realm was not reproducible.** The realm existed only in my Docker volume, so a fresh clone would start with an empty Keycloak. I exported the realm with `kc.sh export` into `keycloak/notes-realm.json`, mounted that folder into Keycloak's import directory, and started Keycloak with `--import-realm`. I verified it by running `docker compose down -v`, starting again, and logging in as both users.
