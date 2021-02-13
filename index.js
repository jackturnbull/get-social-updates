require("dotenv").config();
const Twitter = require("twitter-lite");
const TelegramBot = require("node-telegram-bot-api");
const { any, compose, contains, equals, flip, gt, intersection, length, map, pathOr, prop, toLower } = require("ramda");

const TWITTER_USERS = ["getprotocol", "bloemersmaarten"];
const TWITTER_SYMBOLS = ["get"];
const TWITTER_BLACKLIST = ["huobi"];
const MAXIMUM_SYMBOLS_COUNT = 4;

const telegramBot = new TelegramBot(process.env.TELEGRAM_TOKEN);
const twitterClient = new Twitter({
  consumer_key: process.env.TWITTER_CONSUMER_KEY,
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
  access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY,
  access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

// Getters
const getContent = (tweet) => tweet.full_text || pathOr(tweet.text, ["extended_tweet", "full_text"], tweet);
const getSymbols = pathOr([], ["entities", "symbols"]);
const getUserMentions = pathOr([], ["entities", "user_mentions"]);
const getUserName = pathOr("N/A", ["user", "screen_name"]);

// Content checkers
const tweetContainsSymbol = (symbols) =>
  gt(length(intersection(map(compose(toLower, prop("text")), symbols), TWITTER_SYMBOLS)), 0);
const tweetContainsUserMention = (userMentions) =>
  gt(length(intersection(map(compose(toLower, prop("screen_name")), userMentions), TWITTER_USERS)), 0);
const tweetFromUser = (screenName) => any(equals(toLower(screenName)), TWITTER_USERS);

// Boolean flags
const isRetweet = (tweet) => !!tweet.retweeted_status;
const isTweetTruncated = (tweet) => !!tweet.truncated;

// Composed selectors
const doesTweetContainBlacklist = (tweet) => any(flip(contains)(toLower(getContent(tweet))), TWITTER_BLACKLIST);
const doesTweetContainTooManySymbols = (tweet) => gt(length(getSymbols(tweet)), MAXIMUM_SYMBOLS_COUNT);
const doesTweetContainReference = (tweet) =>
  tweetFromUser(getUserName(tweet)) ||
  tweetContainsSymbol(getSymbols(tweet)) ||
  tweetContainsUserMention(getUserMentions(tweet));

const pushToTelegram = (tweet) => {
  const { id_str: id } = tweet;

  const tweetContent = getContent(tweet);
  const tweeterName = getUserName(tweet);
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

  if (doesTweetContainTooManySymbols(tweet)) {
    console.log("[INFO] tweet contains too many symbols with ID", id);
    return;
  }

  if (doesTweetContainBlacklist(tweet)) {
    console.log("[INFO] blacklisted tweet with ID", id);
    return;
  }

  if (!isTweetTruncated(tweet) && doesTweetContainReference(tweet)) {
    console.log("[INFO] tweet complete from stream, pushing to telegram", id);
    pushToTelegram(tweet);
    return;
  }

  console.log("[INFO] fetching extended tweet with ID", id);
  const extendedTweet = await twitterClient.get("statuses/show", {
    id,
    tweet_mode: "extended",
  });

  if (doesTweetContainReference(extendedTweet)) {
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

const trackUsers = TWITTER_USERS.map((user) => `@${user}`);
const trackSymbols = TWITTER_SYMBOLS.map((symbol) => `$${symbol}`);

twitterClient
  .stream("statuses/filter", {
    track: [...trackUsers, ...trackSymbols].join(","),
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
