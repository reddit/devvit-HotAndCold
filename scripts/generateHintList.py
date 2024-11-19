import re
from wordfreq import get_frequency_dict
from nltk.corpus import stopwords, names
import nltk
from pathlib import Path
import requests
from nltk.stem.snowball import SnowballStemmer
import os

# Get the directory where this script is located
SCRIPT_DIR = Path(__file__).parent.absolute()

# Configuration paths
WORD_LISTS_DIR = SCRIPT_DIR / "../words/input"
SOWPODS_PATH = WORD_LISTS_DIR / "sowpods.txt"
FILTERED_OUTPUT_PATH = SCRIPT_DIR / "../words/output/hintsList.csv"
FREQUENCY_OUTPUT_PATH = SCRIPT_DIR / "../words/output/frequencyList.csv"

NUMBER_OF_WORDS = 20000

# Create output directory if it doesn't exist
(SCRIPT_DIR / "../words/output").mkdir(parents=True, exist_ok=True)

# Initialize NLTK data
nltk.download('stopwords')
nltk.download('names')

def get_profanity_list():
    """Get comprehensive profanity list including variations and combinations"""
    
    # Base profanity words
    base_profanity = {
        # Sexual terms
        'fuck', 'shit', 'cock', 'dick', 'penis', 'pussy', 'cunt', 'vagina', 'cum', 'semen',
        'whore', 'slut', 'bitch', 'hooker', 'hoe', 'skank', 'queer', 'fag', 'dyke',
        
        # Excretory terms
        'piss', 'poop', 'crap', 'ass', 'arse', 'butt',
        
        # Slurs and offensive terms 
        'nigger', 'nigga', 'chink', 'spic', 'wetback', 'kike', 'kyke', 'fagot', 'faggot',
        'retard', 'tard', 'homo', 'tranny', 'twat', 'paki', 'gook', 'honky', 'wop', 'dago',
        'raghead', 'towelhead', 'beaner', 'gringo', 'cracka', 'cracker', 'redneck', 'whitey',
        'zipperhead', 'wigger', 'wigga', 'wog', 'yid',
        
        # Religious/blasphemous
        'goddamn', 'goddam', 'damn', 'hell', 'bastard',

        # Body parts
        'tit', 'tits', 'titty', 'boob', 'knocker', 'ballsack', 'nuts', 'nutsack',
        
        # Other offensive
        'douche', 'douchebag', 'scumbag', 'motherfucker', 'fucker', 'wanker', 'bollocks',
        'prick', 'schmuck', 'asshole', 'arsehole', 'jackass', 'dumbass', 'dipshit',
        'cocksucker', 'blowjob', 'handjob', 'rimjob', 'jizz', 'spunk', 'dildo', 'dong',
        'wang', 'schlong', 'dingus', 'weiner', 'wiener', 'knob', 'pecker', 'chode',
    }

    # Common prefixes
    prefixes = {'dumb', 'horse', 'bull', 'chicken', 'jack', 'ass', 'mother', 'dog', 'pig',
                'dick', 'cock', 'pussy', 'cunt', 'butt', 'cum', 'jizz', 'circle', 'circle'}

    # Common suffixes
    suffixes = {'hole', 'head', 'face', 'wipe', 'wad', 'stain', 'bag', 'sucker', 'licker',
                'lover', 'fucker', 'eating', 'sucking', 'jockey', 'monkey', 'breath', 'brain'}

    # Common variations
    variations = {'ing', 'er', 'ed', 'y', 'ier', 'iest', 'in', 'ez', 'es', 's'}

    # Generate compound words and variations
    profanity_set = base_profanity.copy()
    
    # Add prefix+base combinations
    for prefix in prefixes:
        for base in base_profanity:
            profanity_set.add(prefix + base)
    
    # Add base+suffix combinations
    for base in base_profanity:
        for suffix in suffixes:
            profanity_set.add(base + suffix)
    
    # Add variations of base words
    for word in base_profanity:
        for variation in variations:
            profanity_set.add(word + variation)
    
    # Substrings to check within words
    profanity_substrings = {
        'fuck', 'shit', 'cunt', 'cock', 'dick', 'pussy', 'whore', 'slut', 'bitch',
        'fag', 'nigg', 'spic', 'dyke', 'homo', 'queer', 'tard'
    }

    return profanity_set, profanity_substrings

def get_sowpods():
    print(WORD_LISTS_DIR)
    WORD_LISTS_DIR.mkdir(exist_ok=True)
    if not SOWPODS_PATH.exists():
        url = "https://raw.githubusercontent.com/jesstess/Scrabble/master/scrabble/sowpods.txt"
        response = requests.get(url)
        if response.status_code == 200:
            SOWPODS_PATH.write_text(response.text.lower(), encoding="utf-8")
    return set(SOWPODS_PATH.read_text(encoding="utf-8").lower().split())

def is_plural(word, stemmer):
    if word.endswith(('s', 'es', 'ies')):
        singular = stemmer.stem(word)
        return singular != word
    return False

def contains_profanity(word, profanity_set, profanity_substrings):
    word = word.lower()
    if word in profanity_set:
        return True
    return any(substring in word for substring in profanity_substrings)

def is_base_form(word, stemmer):
    """Check if word is in its base form (no tense, no gerund, etc.)"""
    base = stemmer.stem(word)
    return base == word and not word.endswith(('ed', 'ing', 's', 'es', 'ies'))

def is_valid_word(word, valid_words, name_set, stemmer, profanity_set, profanity_substrings):
    word = word.lower()
    
    if (len(word) <= 2 or  # too short
        re.search(r'\d', word) or  # contains numbers
        any(p in word for p in "'-") or  # contains apostrophes or hyphens
        word in name_set or  # is a name
        not word.isalpha() or  # non-letter characters
        not is_base_form(word, stemmer) or  # not in base form
        contains_profanity(word, profanity_set, profanity_substrings)):  # contains profanity
        return False
        
    return word in valid_words

def process_word_list():
    stop_words = set(stopwords.words('english'))
    name_set = {name.lower() for name in names.words()}
    valid_words = get_sowpods()
    stemmer = SnowballStemmer("english")
    profanity_set, profanity_substrings = get_profanity_list()
    
    # Get frequency dictionary
    freq_dict = get_frequency_dict('en')
    
    # Save raw frequency list first (top 50,000 most common words)
    print("Generating raw frequency list...")
    raw_frequencies = sorted(freq_dict.items(), key=lambda x: x[1], reverse=True)[:NUMBER_OF_WORDS]
    
    FREQUENCY_OUTPUT_PATH.write_text("word,frequency\n", encoding="utf-8")
    with FREQUENCY_OUTPUT_PATH.open("a", encoding="utf-8") as f:
        for word, freq in raw_frequencies:
            f.write(f"{word},{freq}\n")
    print(f"Raw frequency list saved to: {FREQUENCY_OUTPUT_PATH}")
    
    # Now process filtered words
    print("\nGenerating filtered hints list...")
    filtered_words = {}
    
    for word, freq in freq_dict.items():
        word = word.lower()
        if word in stop_words:
            continue
        if not is_valid_word(word, valid_words, name_set, stemmer, profanity_set, profanity_substrings):
            continue
            
        filtered_words[word] = freq

    # Sort and save filtered words
    word_frequencies = sorted(filtered_words.items(), key=lambda x: x[1], reverse=True)[:NUMBER_OF_WORDS]
    
    # Write filtered output
    FILTERED_OUTPUT_PATH.write_text("word,frequency\n", encoding="utf-8")
    with FILTERED_OUTPUT_PATH.open("a", encoding="utf-8") as f:
        for word, freq in word_frequencies:
            f.write(f"{word},{freq}\n")
    
    print(f"Filtered hints list saved to: {FILTERED_OUTPUT_PATH}")
    print(f"\nStats:")
    print(f"Total raw words: {len(raw_frequencies)}")
    print(f"Total filtered words: {len(word_frequencies)}")
    print("\nTop 20 most frequent words (raw):")
    for word, freq in raw_frequencies[:20]:
        print(f"{word}: {freq}")
    print("\nTop 20 filtered words:")
    for word, freq in word_frequencies[:20]:
        print(f"{word}: {freq}")

if __name__ == "__main__":
    process_word_list()
