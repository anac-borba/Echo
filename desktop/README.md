# Echo para computador

Uma janela com o Echo de sempre (o site publicado na Cloudflare), mais o que o navegador não deixa:

- **Compartilhar tela** numa janela do próprio Echo, com as abas Telas e Janelas.
- **Som do computador** indo junto com a tela. No Windows funciona; no Mac depende da versão do macOS (14 ou mais nova).
- Links de fora abrem no navegador. O app se atualiza sozinho quando o site é publicado de novo.

Ainda não tem: escolher o som de cada app e o controle remoto. Os dois precisam de código nativo e vêm nas próximas versões.

## Baixar

Vá em **Releases** no GitHub e baixe:
- Mac: `Echo-…-mac-arm64.dmg` (Macs com chip M1, M2, M3…) ou `Echo-…-mac-x64.dmg` (Macs Intel).
- Windows: `Echo-…-win-x64.exe`.

### Primeira vez no Mac
O app não tem a assinatura paga da Apple, então o macOS bloqueia na primeira abertura.
1. Arraste o Echo para Aplicativos e tente abrir.
2. Abra **Ajustes do Sistema → Privacidade e Segurança**, desça até o aviso do Echo e clique em **Abrir Mesmo Assim**.
3. Se aparecer "está danificado", abra o Terminal e rode: `xattr -cr /Applications/Echo.app`

### Primeira vez no Windows
Se aparecer a tela azul "O Windows protegeu o computador", clique em **Mais informações → Executar assim mesmo**.

## Gerar uma versão nova

No GitHub: **Releases → Draft a new release → Choose a tag** → escreva `v1.0.1` (sempre maior que a anterior) → **Publish**.
Ou pelo terminal, na pasta do projeto:

```
git tag v1.0.1 && git push origin v1.0.1
```

O GitHub monta os instaladores em uns 10 minutos (aba **Actions**) e coloca os arquivos na Release.

## Rodar no seu computador (para testar mudanças)

```
cd desktop
npm install
npm start
```
