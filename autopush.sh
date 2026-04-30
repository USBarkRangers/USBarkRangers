#!/bin/bash

# Check if a commit message was provided as an argument
if [ -z "$1" ]; then
  # If no message provided, use an auto-generated name based on the date and time
  MSG="Auto commit: $(date +'%Y-%m-%d %H:%M:%S')"
else
  # Otherwise, use the provided message
  MSG="$1"
fi

echo "📦 Adding changes..."
git add .

echo "📝 Committing with message: '$MSG'..."
git commit -m "$MSG"

echo "🚀 Pushing to GitHub..."
git push

echo "✅ Done!"
