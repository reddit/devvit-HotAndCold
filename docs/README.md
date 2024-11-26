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
