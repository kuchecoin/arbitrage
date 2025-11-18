#!/bin/bash

timestamp=$(date +"%Y-%m-%d_%H-%M-%S")
keyfile=".keys/keys_$timestamp.ky"

# Ensure keys directory exists
mkdir -p .keys

npm run generate-wallets >> "$keyfile" 2>&1
