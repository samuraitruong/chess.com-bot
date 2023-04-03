import puppeteer from "puppeteer";
import axios from "axios";
import notifier from "node-notifier";
import path from "path";

const ICON = path.join(process.cwd(), "apple-touch-icon.f72d3fd3.png");

console.log("ICON", ICON);
//Configuration variables
const MAX_ELO = (process.env.MAX_ELO || 3600) * 1;
const MAX_LEVEL = (process.env.MAX_LEVEL || 28) * 1;
const MIN_LEVEL = (process.env.MIN_LEVEL || 1) * 1;
const ADAPTIVE_OPPONENT_MOVE_TIME =
  (process.env.ADAPTIVE_OPPONENT_MOVE_TIME || 0) * 1;
const RANDOM_MOVE_TIMES = (process.env.RANDOM_MOVE_TIMES || 0) * 1;
const HEADLESS = process.env.HEADLESS === "true";
// Global variables
let board_fen = "";
let playIntervalId;
let busy = false;
let lastFen = null;
let lastResult = null;
let currentGameInfo = {};

const intervalCheck = +(process.env.BOARD_CHECK_INTERVAL || 1000);
const username = process.env.username;
const password = process.env.password;

async function getTextContent(page, selector) {
  const el = await page.$(selector);

  if (el) {
    const text = await page.evaluate((el) => el.textContent.trim(), el);
    return text;
  }

  return null;
}
function readCurrentBoardFen(page) {
  return page.evaluate(() => {
    const space = "-";
    const index = new Array(64).fill(space);
    let hasPiece = false;
    for (var i = 1; i <= 8; i++)
      for (var j = 1; j <= 8; j++) {
        const el = document.querySelector(`.piece.square-${i}${j}`);
        if (el) {
          let piece = el
            .getAttribute("class")
            .split(" ")
            .find((x) => x.length === 2 && ["w", "b"].includes(x[0]));

          if (piece && piece[0] == "w") {
            index[(j - 1) * 8 + i - 1] = piece[1].toUpperCase();
            hasPiece = true;
          }

          if (piece && piece[0] == "b") {
            hasPiece = true;
            index[(j - 1) * 8 + i - 1] = piece[1].toLowerCase();
          }
        }
      }
    const row = [];
    for (var i = 0; i < 8; i++) {
      let fen = index.splice(0, 8).join("");
      for (let t = 8; t >= 1; t--) {
        fen = fen.replace(
          new RegExp(new Array(t).fill(space).join(""), "ig"),
          t.toString()
        );
      }
      row.push(fen);
    }
    const board = row.reverse().join("/");
    const blackMoves = document.querySelectorAll(".black.node");
    const whiteMoves = document.querySelectorAll(".white.node");
    const whoMoveNext = whiteMoves.length > blackMoves.length ? "b" : "w";

    function kqStatus() {
      const w = getCastleingStatus("w");
      const b = getCastleingStatus("b");

      if (w == "-" && b === "-") return "- -";
      return w + b;
    }
    function getCastleingStatus(mover) {
      let king = mover === "b" ? "king-black" : "white-king";
      let query = mover === "b" ? ".black.node" : ".white.node";
      const findMoves = [...document.querySelectorAll(query + " span")].map(
        (x) => x.getAttribute("data-figurine")
      );

      const allMoves = [...document.querySelectorAll(query)].map((x) =>
        x.textContent.trim()
      );

      const testMoves = [...allMoves, ...findMoves];
      if (
        testMoves.includes("K") ||
        testMoves.includes("R") ||
        testMoves.includes("O-O") ||
        testMoves.includes("O-O-0")
      ) {
        return "-";
      }

      if (mover === "b") return "kq";
      return "KQ";
    }

    //const kq = 'KQkq'
    const kq = kqStatus();
    return [`${board} ${whoMoveNext} ${kq} - 1 0`, hasPiece, whoMoveNext];
  });
}

async function getPieceName(page, fromSquare) {
  const findEl = await page.$(fromSquare);
  if (!findEl) {
    return null;
  }
  const className = await page.evaluate((el) => el.className, findEl);

  return className
    .split(" ")
    .find((x) => x.length === 2 && ["w", "b"].includes(x[0]));
}

function getDesiredEngineParams() {
  const defaultValue = {
    elo: 800,
    depth: MIN_LEVEL,
  };
  if (currentGameInfo && currentGameInfo.yourSide === "w") {
    defaultValue.elo = Math.ceil(currentGameInfo.whiteElo || defaultValue.elo);
  }

  if (currentGameInfo && currentGameInfo.yourSide === "b") {
    defaultValue.elo = Math.ceil(currentGameInfo.blackElo || defaultValue.elo);
  }
  // Assume that we  max elo is 3000 and that equivalent to level 20
  const calculatedDepth = Math.ceil((defaultValue.elo / MAX_ELO) * MAX_LEVEL);
  // console.log("calculatedDepth", calculatedDepth);
  defaultValue.depth = Math.max(MIN_LEVEL, calculatedDepth);

  // set depth to 12 if elo is higher than 2000
  console.log("bot params", defaultValue);
  return defaultValue;
}
async function getBestMove(fen) {
  // need make this dynamic base on apponent rated

  if (fen === lastFen && lastResult) {
    return lastResult;
  }
  const { elo, depth } = getDesiredEngineParams();
  await delay(
    (currentGameInfo.avgOppomentMoveTime || 0) * ADAPTIVE_OPPONENT_MOVE_TIME
  );
  const { data } = await axios.get(process.env.STOCKFISH_API + "/" + elo, {
    params: { fen, elo, depth },
  });
  lastResult = data.result.bestmove;
  lastFen = fen;
  return lastResult;
}
async function delay(time) {
  return new Promise(function (resolve) {
    setTimeout(resolve, time);
  });
}
async function closeModalFirst(page, timeout = 5000) {
  try {
    await clickon(page, "[data-cy='modal-first-time-button']", timeout);
  } catch {}
}

async function getCurrentFen(page, isPlayVsHuman) {
  let fen = null;
  try {
    if (isPlayVsHuman) {
      fen = await readCurrentBoardFen(page);
      fen = fen[0];
    } else {
      await clickon(page, "[data-cy='Download']", 1000);
      await delay(100);
      await page.waitForSelector(
        ".share-menu-tab-pgn-section > .ui_v5-input-component",
        { timeout: 1000 }
      );

      fen = await page.$eval(
        ".share-menu-tab-pgn-section > .ui_v5-input-component",
        (input) => {
          return input.value;
        }
      );
      await clickon(page, "[data-cy='share-menu-close']");
    }
  } catch (err) {
    fen = await readCurrentBoardFen(page);
    fen = fen[0];
  }

  console.log("fen", fen);
  return fen;
}

async function ensureLogin(page) {
  console.log("username", username);
  await page.goto(
    "https://www.chess.com/login_and_go?returnUrl=https://www.chess.com/"
  );

  console.log(page.url());

  if (page.url() === "https://www.chess.com/home") {
    console.log("user already logged in");
    return;
  }

  await page.type("#username", username);
  await page.type("#password", password);
  await page.click("#login");
  await delay(2000);
}
async function clickAt(page, square, fromSquare) {
  // console.log("clickAt", square, "from square", fromSquare);
  console.log("Play the move ", fromSquare, square);
  const findEl = await page.$(fromSquare);

  const className = await page.evaluate((el) => el.className, findEl);

  // console.log("className", className);
  const isBlack = className.includes("b") && !className.includes("wb");
  const board = await page.$(".board");
  const rect = await page.evaluate((board) => {
    const { top, left, bottom, right } = board.getBoundingClientRect();
    return { top, left, bottom, right };
  }, board);

  const board_x = rect.left;
  const board_y = rect.top;
  const width = 81;

  const row = +square[1];
  const col = +square[0];
  // this work for play as white
  let x = Math.round(board_x + (col - 1) * width + width / 2);
  let y = Math.round(board_y + (8 - row) * width + width / 2);
  if (isBlack) {
    x = Math.round(board_x + (8 - col) * width + width / 2);
    y = Math.round(board_y + (row - 1) * width + width / 2);
  }
  // console.log(square, "row", row, "col", col, x, y, "isblack", isBlack);

  //   await page.evaluate(
  //     (data) => {
  //       console.log(data);
  //       if (!window.debugDiv) {
  //         window.debugDiv = document.createElement("div");
  //         document.body.appendChild(window.debugDiv);
  //       }

  //       window.debugDiv.style.position = "fixed";
  //       window.debugDiv.style.top = data.y - 40 + "px";
  //       window.debugDiv.style.left = data.x - 40 + "px";
  //       debugDiv.style.border = "1px solid red";
  //       debugDiv.style.width = "80px";
  //       debugDiv.style.height = "80px";
  //     },
  //     { x, y }
  //   );

  await clickon(page, fromSquare, 1000);
  await delay(500);
  await page.mouse.click(x, y);
}
async function isGameOver(page) {
  const url = await page.url();
  if (url.includes("membership")) {
    return true;
  }
  const el = await page.$(".game-over-modal-content");
  if (el) {
    console.log("The game is over!");
    console.log(currentGameInfo);
    const result = await getTextContent(page, ".game-over-header-component");
    console.log(result);
    notifier.notify({
      title: "Game Over",
      message: result,
      icon: ICON,
      contentImage: ICON,
    });
    return true;
  }

  https: return false;
}
async function playWithBestMove(page, isPlayVsHuman, callback) {
  if (busy) return;
  busy = true;

  if (isPlayVsHuman) {
    await delay(Math.random() * RANDOM_MOVE_TIMES);
    // close the leagues division
    await clickon(page, ".leagues-division-started-modal-close", 100, true);

    await getPlayerInformation(page);
  }

  try {
    const checkIfOver = await isGameOver(page);
    if (checkIfOver) {
      busy = false;
      clearInterval(playIntervalId);
      await callback();
    }
    const current_fen = await getCurrentFen(page, isPlayVsHuman);

    if (current_fen && current_fen.includes("#")) {
      console.log("The game is over!");
      clearInterval(playIntervalId);
      await callback();
    }
    // if (current_fen && !current_fen.includes("w")) {
    //   console.log("Skip black move");
    //   busy = false;
    //   return;
    // }

    if ((current_fen && current_fen !== board_fen) || true) {
      const best_move = await getBestMove(current_fen);
      if (best_move.includes("none")) {
        console.log("The game is over!");
        clearInterval(playIntervalId);
        await callback();
        return;
      }
      console.log("best_move", best_move);
      const from = best_move.slice(0, 2);
      const to = best_move.slice(2, 4);
      const fromSquare = "square-" + (from.charCodeAt(0) - 96) + from[1];
      const toSquare = "square-" + (to.charCodeAt(0) - 96) + to[1];
      console.log(from, to, fromSquare, toSquare);
      const findEl = await page.$(".piece." + toSquare);
      const movePiece = await getPieceName(page, "." + fromSquare);
      try {
        if (findEl) {
          await clickon(page, ".piece." + fromSquare, 1000);

          await delay(100);

          await clickon(page, ".piece." + toSquare, 1000);
        } else {
          await clickAt(
            page,
            to.charCodeAt(0) - 96 + to[1],
            ".piece." + fromSquare
          );
        }
        if (to[1] === "8" && ["wp", "bp"].includes(movePiece)) {
          await clickon(page, "div.promotion-piece.wq", 500);
        }
        if (to[1] === "1" && ["wp", "bp"].includes(movePiece)) {
          await clickon(page, "div.promotion-piece.bq", 500);
        }

        board_fen = current_fen;
      } catch (err) {
        try {
          await clickAt(
            page,
            to.charCodeAt(0) - 96 + to[1],
            ".piece." + fromSquare
          );
          // check if that is promotion
          if (to[1] === "8" && ["wp", "bp"].includes(movePiece)) {
            await clickon(page, "div.promotion-piece.wq", 500);
          }
          if (to[1] === "1" && ["wp", "bp"].includes(movePiece)) {
            await clickon(page, "div.promotion-piece.bq", 500);
          }
          board_fen = current_fen;
        } catch (err1) {
          console.log(err1);
        }
        console.log(err);
      }
      // check if the game is over
    }
  } catch (err) {
    console.log(err);
    if (err.message.includes("Session closed.")) {
      await callback();
    }
  }

  busy = false;
}
async function clickon(page, el, timeout = 10000, noLog = false) {
  // console.log("click", el);
  try {
    await page.waitForSelector(el, { timeout });
    await page.click(el);
  } catch (err) {
    if (!noLog) {
      throw err;
    }
  }
}

async function getPlayerInformation(page) {
  try {
    const el = await page.$("[data-cy='chat-message'] span");

    if (el) {
      const text = await page.evaluate((el) => el.textContent.trim(), el);
      const arr = text.split(" ");
      // console.log(arr);

      const gameUrl = await page.url();
      if (gameUrl !== currentGameInfo.gameUrl) {
        currentGameInfo.gameUrl = gameUrl;
        notifier.notify({
          title: "New Game",
          message: "A new game started " + text,
          icon: ICON,
          contentImage: ICON,
        });
      }

      //get play time
      const whiteTimes = await page.$$eval(".time-white", (el) =>
        el.map((x) => x.getAttribute("data-time") * 100)
      );

      const blackTimes = await page.$$eval(".time-black", (el) =>
        el.map((x) => x.getAttribute("data-time") * 100)
      );
      currentGameInfo.whiteTimes = whiteTimes;
      currentGameInfo.blackTimes = blackTimes;

      // No rating

      currentGameInfo.blackAvgMoveTime =
        blackTimes.reduce((a, b) => a + b, 0) / blackTimes.length;

      currentGameInfo.whiteAvgMoveTime =
        whiteTimes.reduce((a, b) => a + b, 0) / whiteTimes.length;

      if (arr[1] === "vs.") {
        const [white, _, black] = arr;
        currentGameInfo.white = white;
        currentGameInfo.whiteElo = 800;

        currentGameInfo.black = black;
        currentGameInfo.blackElo = 800;
        currentGameInfo.yourSide = white === username ? "w" : "b";
      } else {
        const [white, whiteElo, _, black, blackElo, rating] = arr;

        currentGameInfo.white = white;
        currentGameInfo.whiteElo = +whiteElo.replace("(", "").replace(")", "");

        currentGameInfo.black = black;
        currentGameInfo.blackElo = +blackElo.replace("(", "").replace(")", "");
        currentGameInfo.yourSide = white === username ? "w" : "b";
      }

      currentGameInfo.avgOppomentMoveTime =
        currentGameInfo.yourSide == "w"
          ? currentGameInfo.blackAvgMoveTime
          : currentGameInfo.whiteAvgMoveTime;

      // console.log({ whiteTimes, blackTimes });

      // console.log(text, currentGameInfo);
    }
  } catch (err) {
    console.log(err);
  }
}

async function playWithHuman(page, category = "600") {
  await page.goto("https://www.chess.com/play/online");
  delay(1000);
  await clickon(page, '[data-cy="new-game-time-selector-button"]', 2000);
  await delay(1000);

  await clickon(page, `[data-cy="time-selector-category-${category}"]`, 2000);

  await clickon(page, '[data-cy="new-game-index-play"]', 2000);

  await clickon(page, ".fair-play-button", 1000, true);

  let interval = intervalCheck;
  if (category === "60") {
    interval = 500;
  }

  playIntervalId = setInterval(async () => {
    await playWithBestMove(page, true, async () => {
      // start the new game
      await delay(5000);
      busy = false;
      await playWithHuman(page, category);
    });
  }, interval);

  // waiting for new game
}

const playWithComputer = async (page) => {
  // await delay(5000);
  await page.goto("https://www.chess.com/play/computer");
  await closeModalFirst(page, 5000);
  console.log("modal closed");

  const testfen = await getCurrentFen(page);
  console.log("existing game", testfen);
  if (!testfen) {
    await clickon(page, "button[title='Choose']", 2000);
    // set mode as challenge
    await clickon(page, "div[data-cy='Challenge']", 1000);
    await clickon(page, "button[title='Play']", 1000);
  }

  console.log("start interval");
  playIntervalId = setInterval(async () => {
    await playWithBestMove(page, true, async () => {
      // start the new game
      await delay(5000);
      busy = false;
      await playWithComputer(page);
    });
  }, intervalCheck);
};

async function main() {
  const browser = await puppeteer.launch({
    // devtools: true,
    // executablePath:
    //   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    userDataDir: "./data/" + process.env.username,
    headless: HEADLESS,
    handleSIGTERM: true,
    args: ["--mute-audio"],
  });

  const context = browser.defaultBrowserContext();
  context.overridePermissions("https://www.chess.com", ["notifications"]);

  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 1024 });

  await ensureLogin(page);

  console.log("Successfull login ");
  const mode = process.argv[2];
  const category = process.argv[3] || "600";

  if (mode === "computer") {
    await playWithComputer(page);
  }

  if (mode === "human") {
    await playWithHuman(page, category);
  }
}

async function aliveWatcher(page) {
  const url = await page.url();
  // check if url is changed
  // check if ui is not playing UI
  // check if game is stuck
  if (!url.includes("game/live") || !url.includes("overview")) {
    // game is dead
    return false;
  }

  return true;
}

async function playOfflineGames(page) {
  console.log("TBD");
  // check if the offline game is available and play them
  // after each game it will also start new offline game to keep the bot busy 24/7:)
}

main();
