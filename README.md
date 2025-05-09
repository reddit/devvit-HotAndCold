# HotAndCold

Guess the secret word by entering words with similar meanings. Words are scored based on how semantically related they are to the target word.

Example: If the secret word is "ocean":

- sea: would score 80-100 (highly related)
- wave: would score 40-79 (somewhat related)
- calculator: would score 0-39 (distantly/unrelated)

Think about synonyms, categories, and related concepts to find the secret word.

## Playing

This is the app that runs the [HotAndCold](https://www.reddit.com/r/HotAndCold/) subreddit. Feel free to stop by and play anytime!

## Installing on another Subreddit

You can install this game on your own subreddit if you would like to give it a try. All you need to do is install the app onto the subreddit. After installing, it will automatically run installation jobs and start posting new challenges daily.

## Source Code

The [code for HotAndCold is open source](https://github.com/reddit/devvit-HotAndCold)! Feel free to suggest improvements, fork, and submit PRs with new features and improvements.

## Development

This app is set up to allow you to upload your own app based on this source code and playtest it in your own subreddit. In order to do so, create a `.env.development` file similar to below:

```
# The subreddit you use to playtest.
SUBREDDIT=chicagohighwaytest

# The file specifying your classic app.
# Replace "dan" with whatever you like.
CLASSIC_DEVVIT_CONFIG=dan.devvit.yaml

# The file specifying your raid app.
RAID_DEVVIT_CONFIG=raid.devvit.yaml
```

Then create your yaml file:

```
# Name of your app - must be unique on devvit.
name: h-c-dan
version: 0.0.0
```

Both files should be at the root, adjacent to this README file.

Afterward, you can run `npm run dev:upload:classic` and `npm run dev:classic` from the root of the project, and similar commands for raid.
