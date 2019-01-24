#!/usr/bin/env node
const fs = require('fs')
const express = require('express')
const path = require('path')

const { configSpcp, configMyInfo } = require('./lib/express')

const PORT = process.env.MOCKPASS_PORT || process.env.PORT || 5156

if (!process.env.SINGPASS_ASSERT_ENDPOINT && !process.env.CORPPASS_ASSERT_ENDPOINT) {
  throw new Error('Either SINGPASS_ASSERT_ENDPOINT or CORPPASS_ASSERT_ENDPOINT must be set')
}
const serviceProvider = {
  cert: fs.readFileSync(path.resolve(__dirname, process.env.SERVICE_PROVIDER_CERT_PATH || './static/certs/server.crt')),
  pubKey: fs.readFileSync(path.resolve(__dirname, process.env.SERVICE_PROVIDER_PUB_KEY || './static/certs/key.pub')),
}

const app = configSpcp(express(), {
  serviceProvider,
  idpConfig: {
    singPass: {
      id: process.env.SINGPASS_IDP_ID || 'https://saml-internet.singpass.gov.sg/FIM/sps/SingpassIDPFed/saml20',
      assertEndpoint: process.env.SINGPASS_ASSERT_ENDPOINT,
    },
    corpPass: {
      id: process.env.CORPPASS_IDP_ID || 'https://saml.corppass.gov.sg/FIM/sps/CorpIDPFed/saml20',
      assertEndpoint: process.env.CORPPASS_ASSERT_ENDPOINT,
    },
  },
  showLoginPage: process.env.SHOW_LOGIN_PAGE === 'true',
})

configMyInfo(app, { serviceProvider, port: PORT })

app.enable('trust proxy')
app.use(express.static(path.join(__dirname, 'public')))

app.listen(
  PORT,
  err => err
    ? console.error('Unable to start MockPass', err)
    : console.warn(`MockPass listening on ${PORT}`)
)
