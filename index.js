import _ from 'lodash';
import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import fs from 'fs';
import got from 'got';
import YAML from 'yaml';

import CommitteeDataLoader from './services/CommitteeDataLoader.js';
import VideoLoader from './services/VideoLoader.js';
import GdocWriter from './services/GdocWriter.js';


dotenv.config();

const app       = express();
const port      = 3000;

// Eventually run this every X hours
// cron.schedule('* * * * *', main);

const main = async () => {

  try {
    await mongoose.connect(process.env.DATABASE_URL, {
      useNewUrlParser: true,
      useFindAndModify: false,
      useUnifiedTopology: true,
      useCreateIndex: true
    });
  } catch (err) {
    console.log(`Error connecting to database: ${err.message}`);
    process.exit(1);
  }

  console.log(`Loading committee list...`);

  // For testing purposes, here's a sample of 1 committee:
  // const exampleCommitteeListFile = fs.readFileSync('./config/sources/example_committee_list.yml', 'utf8');
  // const committeeList = YAML.parse(exampleCommitteeListFile);

  // Grab the full committees list from @unitedstates
  const sourcesFile = fs.readFileSync('./config/sources/external.yml', 'utf8');
  const sources = YAML.parse(sourcesFile);
  const committeeListYaml = await got.get(sources.committeesList)
    .then((response) => {
      return response.body;
    })
    .catch((err) => {
      console.log("Error: Cannot reach committee list.");
      process.exit(1);
    });

  const committeeListRaw = YAML.parse(committeeListYaml);
  const committeeList = _.filter(committeeListRaw, { type: 'house' });

  const committeeDataLoadingPromises = committeeList.map(async (committee) => {

    if (!committee.youtube_id) {
      return;
    }

    const committeeLoader = new CommitteeDataLoader();
    await committeeLoader.loadNewEvents(committee);

    console.log(`Getting list of videos for ${committee.name} and matching them to events...`);

    const videoLoader = new VideoLoader(process.env.GOOGLE_API_KEY);
    await videoLoader.loadAndMatch(committee.thomas_id, committee.youtube_id);
    await videoLoader.matchMissingVideos(committee.thomas_id, committee.youtube_id);
  });

  await Promise.all(committeeDataLoadingPromises);

  console.log(`Uploading events data to Google Sheet...`);

  const gdocWriter = new GdocWriter({
    committeeList: committeeList,
    googleApiKey: process.env.GOOGLE_API_KEY,
    googleSpreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
    googleSheetId: process.env.GOOGLE_SHEET_ID,
    googleServiceAccountKeyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  });

  const uploadSuccess = await gdocWriter.exportAndUploadToGdoc();

  if (uploadSuccess) {
    process.exit();
  } else {
    console.log("Error uploading data.");
    process.exit(1);
  }
}

// As a proof of concept, a server is pointless, and this could even be a lambda
// function, but eventually this should be run as a cron job to refresh data every x hours.
//
// app.listen(port, main);
main();