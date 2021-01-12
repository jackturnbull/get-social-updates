require("dotenv").config();
const Twitter = require("twitter-lite");
const TelegramBot = require("node-telegram-bot-api");
const { pathOr } = require("ramda");

const GET_TWITTER_USER = "getprotocol";
const GET_TWITTER_TAG = "get";

const telegramBot = new TelegramBot(process.env.TELEGRAM_TOKEN);

const client = new Twitter({
  consumer_key: process.env.TWITTER_CONSUMER_KEY,
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
  access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY,
  access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

const tweetContainsGetSymbol = (symbols) => symbols.find(({ text }) => text.toLowerCase() === GET_TWITTER_TAG);
const tweetContainsGetUserMention = (userMentions) => userMentions.find(({ screen_name: screenName }) => screenName.toLowerCase() === GET_TWITTER_USER);
const isRetweet = (tweet) => !!tweet.retweeted_status;
const isTweetTruncated = (tweet) => !!tweet.truncated;
const isTweetValid = (tweet) => tweetContainsGetSymbol(getSymbols(tweet)) || tweetContainsGetUserMention(getUserMentions(tweet));

const getSymbols = pathOr([], ["entities", "symbols"]);
const getUserMentions = pathOr([], ["entities", "user_mentions"]);

const pushToTelegram = (tweet) => {
  const { id_str: id } = tweet;

  const tweeterName = pathOr("N/A", ["user", "screen_name"], tweet);
  const tweetContent = tweet.full_text || pathOr(tweet.text, ["extended_tweet", "full_text"], tweet);
  const messageText = `<a href="https://twitter.com/${tweeterName}"><strong>@${tweeterName}</strong></a>: ${tweetContent}`;

  telegramBot.sendMessage(process.env.TELEGRAM_CHANNEL, messageText, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Open Profile",
            url: `https://twitter.com/${tweeterName}`,
          },
          {
            text: "Open Tweet",
            url: `https://twitter.com/${tweeterName}/status/${id}`,
          },
        ],
      ],
    },
  });
};

const processTweet = async (tweet) => {
  const { id_str: id } = tweet;
  console.log("[INFO] received tweet with ID", id);

  if (isRetweet(tweet)) {
    console.log("[INFO] skipping retweet with ID", id);
    return;
  }

  if (!isTweetTruncated(tweet) && isTweetValid(tweet)) {
    console.log("[INFO] tweet complete from stream, pushing to telegram", id);
    pushToTelegram(tweet);
    return;
  }

  console.log("[INFO] fetching extended tweet with ID", id);
  const extendedTweet = await client.get("statuses/show", {
    id,
    tweet_mode: "extended",
  });

  if (isTweetValid(extendedTweet)) {
    console.log("[INFO] pushing extended tweet to telegram", id);
    pushToTelegram(extendedTweet);
    return;
  }

  return;
};

const errorLogger = (e) => console.error("[FATAL]", e.message);
const errorHandler = (e) => {
  errorLogger(e);
  process.exit(1);
};

client
  .stream("statuses/filter", {
    track: `@${GET_TWITTER_USER},$${GET_TWITTER_TAG}`,
  })
  .on("data", (data) => {
    try {
      processTweet(data);
    } catch (e) {
      errorLogger(e);
    }
  })
  .on("error", errorHandler)
  .on("end", errorHandler);
