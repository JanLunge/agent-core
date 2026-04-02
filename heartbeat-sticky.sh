#!/bin/bash
# Dice Roller for Heartbeats
# Output: just the roll number (1-6)

ROLL=$((RANDOM % 6 + 1))
echo "$ROLL"
