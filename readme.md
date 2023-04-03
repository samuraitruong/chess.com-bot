## This project is for educational purposes

## Introduction
This project aims to build automation tools that place games on chess.com with the computer or other online people.  In the background, it will send a request to stockfish API 
## Prerequisites
- The stockfish API can be found at this repo: https://github.com/samuraitruong/stockfish-docker
```sh
docker run ghcr.io/samuraitruong/stockfish-docker:14.1 stockfish
```
Then the API is listening on port 8080 so you

## Run  it 

1. rename .env.sample to .env and update your username and password & stockfish API
2. Play with human
```sh
    yarn && yarn start

```
- yarn play:rapid -> to play rapid mode 10 minutes
- yarn play:bullet -> to play 1 minute game (got ban after 1 hours :)
- yarn signup  -> auto register new account. 
## Warning
DO NOT USE WITH YOUR MAIN ACCOUNT
Use at your own risk, Chess.com will detect and ban your account after few games or reported by other player. 