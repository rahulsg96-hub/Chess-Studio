"""Count the most common words in a text file."""

import sys
from collections import Counter


def count_words(text):
    words = [w.strip(".,!?;:\"'()").lower() for w in text.split()]
    return Counter(w for w in words if w)


def main():
    if len(sys.argv) < 2:
        print("usage: python wordfreq.py <file> [top-n]")
        return 1

    top_n = int(sys.argv[2]) if len(sys.argv) > 2 else 5

    with open(sys.argv[1]) as f:
        counts = count_words(f.read())

    for word, n in counts.most_common(top_n):
        print(f"{n:4}  {word}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
