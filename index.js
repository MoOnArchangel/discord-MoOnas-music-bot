require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus
} = require("@discordjs/voice");

const ytdl = require("ytdl-core");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const { spawn } = require("child_process");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const player = createAudioPlayer();
const queue = [];
let isPlaying = false;
let connection = null;

async function playNext() {
  if (queue.length === 0) {
    isPlaying = false;
    return;
  }

  isPlaying = true;
  const url = queue.shift();

  try {
    const stream = ytdl(url, { filter: "audioonly", quality: "highestaudio" });

    const ffmpegProcess = spawn(ffmpegPath, [
      "-i", "pipe:0",
      "-f", "s16le",
      "-ar", "48000",
      "-ac", "2",
      "pipe:1"
    ]);

    stream.pipe(ffmpegProcess.stdin);

    const resource = createAudioResource(ffmpegProcess.stdout);
    player.play(resource);
    connection.subscribe(player);
  } catch (err) {
    console.error("Error playing stream:", err);
    playNext(); // skip to next if failed
  }
}

player.on(AudioPlayerStatus.Idle, () => {
  playNext();
});

client.on("messageCreate", async message => {
  if (message.author.bot) return;

  const args = message.content.split(" ");
  const command = args.shift().toLowerCase();

  if (command === "!play") {
    const url = args[0];
    if (!url) return message.reply("Provide a YouTube link!");

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply("Join a voice channel first!");

    if (!connection) {
      connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator
      });
    }

    queue.push(url);
    message.reply(`Added to queue! Position: ${queue.length}`);

    if (!isPlaying) playNext();
  }

  if (command === "!skip") {
    player.stop();
    message.reply("Skipped current track!");
  }

  if (command === "!stop") {
    queue.length = 0;
    player.stop();
    message.reply("Stopped and cleared queue!");
  }

  if (command === "!queue") {
    if (queue.length === 0) return message.reply("Queue is empty!");
    message.reply("Queue:\n" + queue.map((u, i) => `${i + 1}. ${u}`).join("\n"));
  }
});

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);