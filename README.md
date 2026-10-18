# Rey Collection

Aplicação web para organizar uma coleção pessoal de jogos. A interface é estática e pode ser hospedada no GitHub Pages. Os jogos são gravados no Supabase; não dependem do armazenamento local do navegador.

## Recursos

- Painel com total de jogos, finalizados, em andamento, valor investido e distribuição por plataforma.
- Cadastro e edição de título, plataforma, gênero, status, nota, preço, data e observações.
- Pesquisa de jogos na IGDB, com filtros por plataforma e gênero.
- Lista de desejos, filtros da coleção, modo escuro e layout adaptável a celular.
- Backup em JSON para exportar e importar a coleção.
- Banco Postgres no Supabase, com isolamento das coleções por sessão e políticas RLS.
- Login por Google ou Apple para acessar a mesma coleção em outros dispositivos.

## Configurar o Supabase

1. Crie um projeto no [Supabase](https://supabase.com/dashboard).
2. No SQL Editor do projeto, execute o conteúdo de `supabase/schema.sql` para criar a tabela e as políticas de segurança.
3. Em **Authentication > Sign In / Providers**, habilite **Allow anonymous sign-ins** e configure os provedores Google e/ou Apple. A aplicação usa uma sessão anônima até a pessoa vincular uma conta.
4. Em **Project Settings > API**, copie a URL do projeto e a chave **publishable** (ou a chave legada `anon`). Preencha esses valores em `supabase-config.js`.
5. Em **Authentication > URL Configuration**, defina a URL do GitHub Pages como **Site URL** e adicione a URL publicada à lista de redirecionamentos permitidos. Para este projeto, use `https://dioges.github.io/ReyCollection/`. Adicione também `http://127.0.0.1:3000/` para desenvolvimento local.
6. Ative o vínculo manual de identidades em **Authentication > Settings** para que uma coleção anônima possa ser associada a uma conta Google ou Apple.

A chave publishable/anon pode ficar no código do site. Nunca coloque uma chave `service_role` nesse arquivo. O acesso aos jogos é restringido pelas políticas RLS da tabela.

Cada navegador recebe uma sessão anônima persistida. Use **Salvar coleção** no menu lateral para vincular essa coleção ao Google ou à Apple e recuperá-la em outros dispositivos. Se já possuir uma conta, use a opção de entrar: os jogos locais e os da conta serão combinados por identificador.

Para configurar o Google, crie um cliente OAuth do tipo Web no Google Auth Platform e cadastre o ID e o segredo do cliente em **Authentication > Sign In / Providers > Google** no Supabase. Use `https://ckdionqrxycnxobbshmj.supabase.co/auth/v1/callback` como URI de redirecionamento autorizado no Google. Para a Apple, configure o provedor em **Authentication > Sign In / Providers > Apple** com um Services ID, Team ID, Key ID e a chave privada `.p8` da conta Apple Developer; use o mesmo callback como Return URL do Services ID. O segredo OAuth da Apple precisa ser renovado a cada seis meses; mantenha um lembrete para essa rotação.

## Publicar no GitHub Pages

Depois de configurar `supabase-config.js`, envie os arquivos do projeto ao GitHub. No repositório, abra **Settings > Pages**, selecione a branch publicada e a pasta raiz (`/`). O GitHub Pages publica os arquivos estáticos; não execute `server.mjs` no Pages.

Na primeira abertura, se a sessão ainda não tiver uma coleção, os dados antigos em `rey-collection-v1` serão migrados para o Supabase. Depois da gravação confirmada, essa cópia antiga é removida do navegador. Se os dados antigos estiverem associados a outro endereço/site, exporte um backup no site antigo e importe-o no Pages.

## Habilitar pesquisa IGDB no GitHub Pages

O GitHub Pages não executa o servidor Node `server.mjs`. Para a pesquisa IGDB funcionar no site publicado, use a Edge Function incluída em `supabase/functions/igdb`:

1. Crie uma aplicação **Confidential** no [Twitch Developer Console](https://dev.twitch.tv/console/apps) e obtenha o Client ID e o Client Secret.
2. Cadastre `TWITCH_CLIENT_ID` e `TWITCH_CLIENT_SECRET` como secrets do projeto Supabase. Não os coloque no GitHub nem em `supabase-config.js`.
3. Instale e autentique o [Supabase CLI](https://supabase.com/docs/guides/cli) e associe o diretório ao projeto com `supabase link --project-ref SEU_PROJECT_REF`.
4. Publique a função com `supabase functions deploy igdb`.

A aplicação chama essa função para buscar jogos e carregar as opções de filtros. O segredo da Twitch fica no ambiente da função. Para desenvolvimento local, `npm start` ainda inicia o servidor Node existente; configure as credenciais no `.env` local, que está excluído do Git.

## Desenvolvimento local

É necessário Node.js 18 ou superior. Configure o projeto Supabase em `supabase-config.js` e execute:

```sh
npm start
```

Abra `http://127.0.0.1:3000`. A pesquisa local usa o servidor Node existente e suas credenciais Twitch em `.env`; a persistência usa o mesmo banco Supabase da publicação.
