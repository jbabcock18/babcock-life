---
title: The Art of Intrusion
author: Kevin Mitnick
date: 2026-03-11
description: Notes on The Art of Intrusion by Kevin Mitnick.
---

In the early 1990s, four guys wondered if they could predict video-poker machines.

One of them traveled to Washington, D.C. to the reading room of the Patent Office, where he found all of the code for a video poker machine embedded in the patent. Then they bought the exact same production-unit machine for $1,500.

They disassembled the compiled code and started looking through it. They found the random-number generator and figured out how it worked and how it was used.

RNGs in the 1990s, and maybe still, were huge lists of numbers, around 2^32 entries, arranged in random order. At the start of the cycle, the software selected a random place in the list, but after that, until it started a new cycle of play, it used the ensuing numbers from the list.

They reverse engineered the software so that from any known point in the random list, they could determine every subsequent number in the sequence. With additional knowledge about the iteration rate of a particular machine, they could figure out how long, down to minutes and seconds, before the machine would display a royal flush.

They made devices to stick in their shoes so they could input the cards on the screen via binary taps, kind of like Morse code. After 8 cards were inputted, the device would know where they were in the RNG list. That would feed into a computer in their pants, which would compute which cards to keep and which to discard.

So they could just keep winning.

They had to keep it low key and not win too much or too often, but over 3 years, the three of them won about one million dollars.
