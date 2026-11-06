#!/bin/sh
# Bot plays whole Expert charts (100015 has guide lines) with perfect timing; every line should end with "m":0,"gr":0 and an empty error list.
# Needs server.py running on 8765 and Google Chrome installed. Judgement logs the runs leave in ../logs are removed.
cd "$(dirname "$0")"
for song in 100020 100111 100015; do node bot.js $song 3 all 0 1; done
rm -f ../logs/*.json
