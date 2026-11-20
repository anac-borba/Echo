#!/bin/bash
# Publica tudo de uma vez:
#   1. o site e o servidor na Cloudflare (o Echo do navegador e do app se atualizam sozinhos);
#   2. o código no GitHub (anac-borba/echo). Se o app para computador mudou, o GitHub monta a versão nova
#      e os apps no Mac e no Windows se atualizam sozinhos.
# Uso (depois de descompactar o echo.zip):  cd ~/Downloads/telinha && bash publicar.sh
set -e
cd "$(dirname "$0")"
REPO="https://github.com/anac-borba/echo.git"

echo "▸ 1/2 Publicando o site na Cloudflare…"
(cd worker && npx --yes wrangler deploy)

echo "▸ 2/2 Mandando o código para o GitHub…"
if ! command -v git >/dev/null; then echo "Falta o git. No Mac: xcode-select --install"; exit 1; fi
if [ ! -d .git ]; then
  git init -q
  git remote add origin "$REPO"
fi
git fetch -q origin main
# a pasta vira a versão mais nova do GitHub + o que veio no zip por cima
git symbolic-ref HEAD refs/heads/main
git update-ref refs/heads/main FETCH_HEAD
git add -A
if git diff --cached --quiet; then
  echo "  O GitHub já estava igual. Nada a mandar."
else
  git -c user.name="${GIT_NAME:-Ana Clara}" -c user.email="${GIT_EMAIL:-anac-borba@users.noreply.github.com}" commit -q -m "Atualização $(date '+%d/%m/%Y %H:%M')"
  git push -q origin main
  if git diff --name-only HEAD~1 HEAD | grep -q '^desktop/'; then
    echo "  O app para computador mudou: o GitHub está montando a versão nova (uns 15 minutos)."
    echo "  Os apps abertos se atualizam sozinhos (ou em Configurações › Atualizações)."
  fi
fi
echo "✓ Pronto. Recarregue o Echo."
