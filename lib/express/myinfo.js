const _ = require('lodash')
const bodyParser = require('body-parser')
const cookieParser = require('cookie-parser')
const fs = require('fs')
const { pick, partition } = require('lodash')
const { render } = require('mustache')
const path = require('path')
const qs = require('querystring')
const uuid = require('uuid/v1')

const assertions = require('../assertions')
const crypto = require('../crypto')

const MYINFO_ASSERT_ENDPOINT = '/consent/myinfo-com'
const CONSENT_TEMPLATE = fs.readFileSync(path.resolve(__dirname, '../../static/html/consent.html'), 'utf8')

const authorizations = {}

function config (app, { serviceProvider, port }) {
  const { verifyMyInfoSignature } = crypto(serviceProvider)

  // HACK: kludge the hostPort together
  const hostPort = req => ['localhost', '127.0.0.1'].includes(req.hostname)
    ? `${req.hostname}:${port}`
    : req.hostname

  const lookupPerson = allowedAttributes => (req, res) => {
    const requestedAttributes = (req.query.attributes || '').split(',')

    const [attributes, disallowedAttributes] = partition(
      requestedAttributes,
      v => allowedAttributes.includes(v)
    )

    if (disallowedAttributes.length > 0) {
      res.status(401).send({ code: 401, message: 'Disallowed', fields: disallowedAttributes.join(',') })
    } else {
      const persona = assertions.myinfo.personas[req.params.uinfin]
      res.status(persona ? 200 : 404)
        .send(
          persona
            ? pick(persona, attributes)
            : { code: 404, message: 'UIN/FIN does not exist in MyInfo.', fields: '' }
        )
    }
  }

  const allowedAttributes = assertions.myinfo.attributes

  app.get(
    '/myinfo/person-basic/:uinfin/',
    (req, res, next) => {
      const [, authHeader] = req.get('Authorization').split(' ')
      const authHeaderFieldPairs = _(authHeader)
        .replace(/"/g, '')
        .replace(/apex_l2_eg_/g, '')
        .split(',')
        .map(v => v.replace('=', '~').split('~'))

      const authHeaderFields = _(authHeaderFieldPairs)
        .fromPairs()
        .mapKeys((v, k) => _.camelCase(k))
        .value()

      authHeaderFields.clientId = authHeaderFields.appId
      authHeaderFields.singpassEserviceId = authHeaderFields.appId.replace(/^[^-]+-/, '')

      authHeaderFields.httpMethod = req.method

      authHeaderFields.url = `${req.protocol}://${hostPort(req)}${req.baseUrl}${req.path}`
      authHeaderFields.requestedAttributes = req.query.attributes

      if (verifyMyInfoSignature(authHeaderFields.signature, authHeaderFields)) {
        next()
      } else {
        res.status(403).send({ code: 403, message: 'Digital Service is invalid', fields: '' })
      }
    },
    lookupPerson(allowedAttributes.basic)
  )
  app.get('/myinfo/person/:uinfin/', lookupPerson([...allowedAttributes.basic, ...allowedAttributes.income]))

  const AUTHORIZE_ENDPOINT = '/consent/oauth2/authorize'

  app.get('/authorise', (req, res) => {
    const {
      client_id, // eslint-disable-line camelcase
      redirect_uri, // eslint-disable-line camelcase
      attributes,
      purpose,
      state,
    } = req.query
    const relayStateParams = qs.stringify({
      client_id,
      redirect_uri,
      state,
      purpose,
      scope: (attributes || '').replace(/,/g, ' '),
      realm: '/consent/myinfo-com',
      response_type: 'code',
    })
    const relayState = `${AUTHORIZE_ENDPOINT}${encodeURIComponent('?' + relayStateParams)}`
    res.redirect(`/singpass/logininitial?esrvcID=MYINFO-CONSENTPLATFORM&PartnerId=/consent/myinfo-com&Target=${relayState}`)
  })

  app.get(MYINFO_ASSERT_ENDPOINT, (req, res) => {
    const { SAMLart: samlArtifact, RelayState: relayState } = req.query
    const samlArtifactBuffer = Buffer.from(samlArtifact.replace(/ /g, '+'), 'base64')
    const index = samlArtifactBuffer.readInt8(samlArtifactBuffer.length - 1)
    const id = assertions.identities.singPass[index]
    const persona = assertions.myinfo.personas[id]
    if (!persona) {
      res.status(404).send({ message: 'Cannot find MyInfo Persona', samlArtifact, index, id, persona })
    } else {
      res.cookie('connect.sid', id)
      res.redirect(relayState)
    }
  })

  app.get(AUTHORIZE_ENDPOINT,
    cookieParser(),
    (req, res) => {
      const params = {
        ...req.query,
        scope: req.query.scope.replace(/\+/g, ' '),
        id: req.cookies['connect.sid'],
        action: AUTHORIZE_ENDPOINT,
      }

      res.send(render(CONSENT_TEMPLATE, params))
    }
  )

  app.post(AUTHORIZE_ENDPOINT,
    cookieParser(),
    bodyParser.urlencoded({ extended: false, type: 'application/x-www-form-urlencoded' }),
    (req, res) => {
      const id = req.cookies['connect.sid']
      const code = uuid()
      authorizations[code] = id
      const callbackParams = qs.stringify(
        req.body.decision === 'allow'
          ? {
            code,
            ...pick(req.body, ['state', 'scope', 'client_id']),
            iss: `${req.protocol}://${hostPort(req)}/consent/oauth2/consent/myinfo-com`,
          }
          : {
            state: req.body.state,
            error_description: 'Resource Owner did not authorize the request',
            error: 'access_denied',
          }
      )
      res.redirect(`${req.body.redirect_uri}?${callbackParams}`)
    }
  )

  return app
}

module.exports = config