const { execFile } = require('node:child_process');

const CURL_TIMEOUT_SECONDS = 30;
const CURL_MAX_BUFFER_BYTES = 25 * 1024 * 1024;

class CurlHttpError extends Error {
  constructor(status, responseBody, url) {
    super(`Curl request to ${url} failed with HTTP ${status}`);
    this.name = 'CurlHttpError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

function executeCurl(args) {
  return new Promise((resolve, reject) => {
    execFile('curl', args, { encoding: 'utf8', maxBuffer: CURL_MAX_BUFFER_BYTES }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Curl request failed: ${stderr.trim() || error.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function parseCurlOutput(output) {
  let cursor = 0;
  let status = 0;
  let headers = {};

  while (output.startsWith('HTTP/', cursor)) {
    const separator = output.indexOf('\r\n\r\n', cursor);
    if (separator === -1) break;

    const lines = output.slice(cursor, separator).split('\r\n');
    const statusMatch = lines[0]?.match(/^HTTP\/\S+\s+(\d{3})/);
    if (!statusMatch) break;

    status = Number(statusMatch[1]);
    headers = {};
    for (const line of lines.slice(1)) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;
      const name = line.slice(0, colonIndex).trim().toLowerCase();
      const value = line.slice(colonIndex + 1).trim();
      (headers[name] ||= []).push(value);
    }
    cursor = separator + 4;
  }

  if (!status) throw new Error('Curl response did not contain an HTTP status line');

  return {
    status,
    headers,
    body: output.slice(cursor),
    setCookies: headers['set-cookie'] || []
  };
}

async function curlRequest({ url, method = 'GET', headers = {}, body }) {
  const args = [
    '--silent', '--show-error', '--location', '--globoff', '--compressed',
    '--connect-timeout', '10', '--max-time', String(CURL_TIMEOUT_SECONDS),
    '--dump-header', '-', '--request', method
  ];

  for (const [name, value] of Object.entries(headers)) {
    args.push('--header', `${name}: ${value}`);
  }
  if (body !== undefined) args.push('--data-raw', JSON.stringify(body));
  args.push(url);

  const response = parseCurlOutput(await executeCurl(args));
  if (response.status >= 400) throw new CurlHttpError(response.status, response.body, url);
  return response;
}

module.exports = { curlRequest, CurlHttpError, parseCurlOutput };
