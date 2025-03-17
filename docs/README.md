## Structure

The monorepo is separate into two apps:

- classic: The daily single player HotAndCold game
- raid: The multiplayer experience

### Folders

- classic: The devvit classic game
- classic-webview: The webview code
- classic-shared: Code shared between the webview and blocks app
- raid: The devvit raid game
- raid-webview: The webview code
- raid-shared: Code shared between the webview and blocks app
- shared: Code shared everywhere
- webview-common: Shared webview code (things like hooks)

Note that I do hate this, but I hate it the least of all the other options I considered (like a single mega-app).

### Where to go for things

Most of the logic you need will be since `src/core` for the blocks app stuff. Thing are separated into domain models that compose together to
build the app experience. `src/main.tsx` is the glue layer between blocks and webview. It's a big mess, but that's sort of just how it goes with the
current APIs.

Inside of the webview folders, things are much simpler. It's just a Vite React SPA. The only interesting thing to note about the config is that
the `vite.config.ts` is configured to output the bundles to `/webroot` for the corresponding project. This is another Devvit-y thing because `/webroot`
is the actual code served to run the webview on Reddit.com.

#### React Land

Most of the app is ran with the `useGame` hook. It's a big context that hooks up all the listeners for the messages that come from blocks. I like the
pattern well enough, but `useDevvitListener` should probably be a callback instead of something that causes rerenders. I was worried about needing to
memoize the callbacks, which is still valid beef, but perhaps less confusing since `useEffect` is needed in a lot of cases?

Styling is tailwind 3.x. I like it well enough and produces smallish stylesheets that can be compressed.

State management is just React context. You'll see that I'm not being super careful about my rerenders. I haven't noticed any perf problems, but there
are lots of optimizations we could make if needed.

## Running the app

```sh
git clone ...

cd devvit-HotAndCold

npm install

# Development commands
npm run dev:classic
npm run dev:raid
```

> Note: Adding ?playtest=hotandcold-app-d will make live reloading happening when you playtest

### Detached Mode

There is a way to run the classic game in detached mode. This makes it to where you're just coding against the react app and there's no
Devvit stuff to contend with. I find it valuable for UI work. I tried to put in this big mocking layer thing but tbh it was half hearted,
I was in a hurry, and it's mostly tech debt. Despite that, it does work!

To run:

```sh
cd packages/classic-webview

npm run vite

# Go to http://localhost:5173/
```

> Note: If you use a different app name in the devvit.yaml for development you'll need to get a SUPABASE_SECRET from Marcus.

## Running Python Stuff

We use python stuff because it has better word libraries than JS.

```bash
python3 -m venv venv

source venv/bin/activate

pip install nltk wordfreq emoji requests

python3 wordList.py
```

## Cache

Ran into some problems with the nearest words call taking too long causing Devvit problems so I yolo'ed in a forever cache. You can find it in Supabase (not in this codebase really). If you change the dimensions or similarity algorithm please purge it manually by going to supabase and deleting all the rows.
