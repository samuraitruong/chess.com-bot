import puppeteer from "puppeteer";
// import axios from "axios";
// import notifier from "node-notifier";
// import path from "path";

async function delay(time) {
  return new Promise(function (resolve) {
    setTimeout(resolve, time);
  });
}

async function main() {
  const browser = await puppeteer.launch({
    handleSIGTERM: true,
    headless: false,
    slowMo: 100,
    args: ["--mute-audio", "--disable-features=DialMediaRouteProvider"],
  });

  const context = browser.defaultBrowserContext();
  context.overridePermissions("https://www.chess.com", ["notifications"]);

  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 1024 });

  await page.goto("https://www.minuteinbox.com/");

  await page.waitForSelector("#email");

  const email = await page.$eval("#email", (el) => el.innerText);
  console.log(email);
  const username = email.split("@")[0].replace(".", "");
  const chesscom = await browser.newPage();

  await chesscom.goto("https://www.chess.com/register");
  await chesscom.waitForSelector("#registration_username");

  await chesscom.type("#registration_username", username);
  await delay(5000);
  await chesscom.type("#registration_email", email);
  await delay(5000);
  await chesscom.type("#registration_password", process.env.password);
  await delay(5000);
  await chesscom.click("#registration_submit");

  await page.waitForFunction(() => {
    return document.body.innerHTML.includes("Chess.com");
  });

  console.log("got the email");

  await page.goto("https://www.minuteinbox.com/window/id/2");

  await page.waitForSelector(".montserrat a");

  await page.click(".montserrat a");

  console.log("Account activated");

  console.log("username is", username);
  console.log("password is", password);
  console.log("email is", email);
  // get the user email from email page

  // fill that into the chesscom page

  // activate the account

  // update password into the .env file
}

main();
