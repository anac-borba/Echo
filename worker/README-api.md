# API do Echo (resumo)

Tudo em JSON. Erros: `{"error":"codigo"}`. Toda requisição que não é GET precisa do cabeçalho `X-Telinha: 1`
e de `Origin` igual ao endereço do site (senão `403 csrf`). Login = cookie `telinha_s` (HttpOnly, SameSite=Strict, 30 dias).
Corpo máximo: 1 MB.

| Método e rota | O que faz |
|---|---|
| GET /api/status | `{accounts, max, needsCode}` (público) |
| POST /api/signup `{username, pw, code?}` | cria conta (201 `{user}`); `pw` = hash hex de 64 caracteres feito no navegador |
| POST /api/login `{username, pw}` | `{user}`; 5 erros seguidos → 429 com `Retry-After` |
| POST /api/logout · GET /api/me · PATCH /api/me · POST /api/me/password `{pw,newPw}` | conta e perfil |
| POST /api/passkey/register/begin · /register/finish `{id, response, name?}` | (com sessão) cadastra uma passkey; begin devolve as opções WebAuthn em JSON (base64url) |
| POST /api/passkey/login/begin `{username?}` · /login/finish `{id, response}` | login por passkey (sem `username` = credencial descobrível); cria a sessão como o login por senha → `{user}` |
| GET /api/passkeys · PATCH /api/passkeys/:id `{name}` · DELETE /api/passkeys/:id | lista (`{passkeys:[{id,name,createdAt,lastUsedAt,transports}],max}`), renomeia e apaga as passkeys da conta |
| GET /api/users/:id | perfil de si, amigo ou colega de servidor |
| GET /api/friends · POST /api/friends `{username}` · POST /api/friends/:id/accept · DELETE /api/friends/:id | amigos |
| GET/POST /api/servers · PATCH/DELETE /api/servers/:id · POST .../leave · DELETE .../members/:userId | servidores |
| POST .../channels · PATCH/DELETE .../channels/:cid | salas do servidor (máx. 8) |
| POST/GET .../invites · DELETE .../invites/:code · GET /api/invites/:code · POST /api/invites/:code/join | convites |
| GET /api/ice?room=ROOM | servidores STUN/TURN (só quem tem permissão na sala) |
| WS /events | presença e avisos em tempo real |
| WS /ws?room=ROOM | sinalização WebRTC (2 pessoas por sala) |

Salas: `c:<idDoCanal>` (membros do servidor) ou `d:<idA>:<idB>` (duas amigas, ids em ordem crescente).

## Segurança
- Senha: o navegador manda um hash (PBKDF2 600 mil voltas); o servidor faz outro PBKDF2-SHA256 (100 mil voltas, sal aleatório) e compara em tempo constante. Login de usuário inexistente gasta o mesmo tempo.
- Sessão: 32 bytes aleatórios; no banco só o SHA-256. Trocar a senha encerra as outras sessões.
- Cadastro limitado a `MAX_ACCOUNTS` (padrão 2); `SIGNUP_CODE` opcional.
- Anti-CSRF: cookie SameSite=Strict + cabeçalho `X-Telinha` + checagem de Origin (inclusive nos WebSockets).
- SQL sempre com parâmetros; toda entrada validada (imagens: tipo, tamanho e assinatura do arquivo).
- Limites de tentativas: login, cadastro, pedidos de amizade, convites, toques (1 por 5 s), mensagens de sinalização.
- O servidor nunca grava voz/vídeo nem registra senhas, cookies ou corpos de requisição.

## Passkeys (WebAuthn)
- Sem e-mail/telefone: o aparelho guarda a chave privada (Face ID, Touch ID, Windows Hello); o servidor guarda só a chave pública (JWK) em `passkeys`.
- Máx. 5 por conta (`403 limit_reached`); credencial repetida → `409 passkey_exists`. Sem sessão no register → `401 unauthenticated`.
- Desafio: 32 bytes aleatórios, uso único (apagado ao ser consultado), validade 5 min, ligado ao fluxo (register = usuária da sessão; login = `username` do begin). Falha → `400 invalid_challenge`.
- `rpId` = hostname do pedido; origin exato `https://host` (ou `http://localhost:porta` no dev; outro http → `400 passkey_unsupported_origin`). Confere type, challenge, origin, rpIdHash, flags UP+UV (`userVerification: required`, `residentKey: required`), `signCount` (se algum for ≠ 0, tem de crescer) e assinatura ES256 (-7) ou RS256 (-257, RSA >= 2048). Attestation `none` (o CBOR do `attestationObject` é lido, a declaração não é verificada).
- Register: dados inválidos → `400 passkey_invalid`. Login: qualquer falha de credencial → `401 invalid_credentials` (igual ao login por senha).
- Anti-enumeração: `login/begin` com `username` inexistente (ou sem passkey) devolve 200 com 1 a 4 ids de credencial falsos, estáveis por usuário, mesma forma da resposta real.
- Limites: 5 falhas seguidas por (usuário+IP) ou 40 por IP → `429` com `Retry-After` (vale também para o begin); begin limitado a 60 por 10 min por IP.
- Formato do `finish`: `{id, name?, response:{clientDataJSON, attestationObject, transports?}}` (register) e `{id, response:{clientDataJSON, authenticatorData, signature, userHandle?}}` (login); tudo em base64url. Front: `web/js/passkey.js`.
