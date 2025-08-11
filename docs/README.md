## HotAndCold2

## Making word lists

First create a words folder in the root of the repo.

Then, download a pretrained model from here and place it in the words folder:
https://github.com/stanfordnlp/GloVe?tab=readme-ov-file#download-pre-trained-word-vectors-new-2024-vectors

Update the scripts in `/tools` with the file name.

Then, create a text file named `word-list.txt` and add words separated by new lines.

```py
python3 -m venv .venv

source .venv/bin/activate

pip install -r requirements.txt
```

Then run `npm run scripts:make`
