// Collection Utils
const subParagraph = (paragraph, startword, endword) => {
    const startIx = paragraph.indexOf(startword);
    if (startIx < 0) return undefined;
    return paragraph.substring(
        startIx + startword.replaceAll("\\", "").length,
        paragraph.indexOf(endword, startIx + startword.replaceAll("\\", "").length)
    );
};
const cartesian = (...a) => a.reduce((a, b) => a.flatMap((d) => b.map((e) => [d, e].flat())));
const range = (start, end, step) => {
    return Array.from(Array.from(Array(Math.ceil((end - start) / step)).keys()), (x) => start + x * step);
};
const partition = (array, n) => (array.length ? [array.splice(0, n)].concat(partition(array, n)) : []);
const shortRandom = () => (Math.random() + 1).toString(36).substring(2);

// Message Utils
const trimPrefix = (m) => m.match(/~m~.*~m~(.*)/)[1];

// Socket context
const socketContext = {
    chart_sess: "cs_" + shortRandom(),
    quote_sess: "qs_" + shortRandom(),
    killflag: false,
    socketInterval: 2000,
    watchDogPeriod: 30000,
    hbMessageLen: 20,
    results: {},
    studiesFinished: 0,
    logger: console,
    waitForReadyState(ready_state) {
        const self = this;
        let interval;
        const isReady = () => self.wss.readyState === ready_state;
        return isReady()
            ? Promise.resolve()
            : new Promise((resolve) => {
                  interval = setInterval(() => isReady() && clearInterval(interval) && resolve(), self.socketInterval);
              });
    },
    sendM(m) {
        if (!m) {
            return;
        }
        const self = this;

        const length = m.replaceAll("\\\\", "\\").length;
        self.logger.debug(`OUT:~m~${length}~m~${m}`);
        self.wss.send(`~m~${length}~m~${m}`);
    },
    stop() {
        this.killflag = true;
        this.wss.close();
    },
    isStopped() {
        return this.killflag;
    },
    getStudyPayload(ix) {
        return (
            this.studies[ix] && this.studies[ix].studyPayload &&
            this.studies[ix].studyPayload.replace(/p":\[("(?:[^"\\]|\\.)*")/, `p":["${this.chart_sess}"`)
        );
    },
    nextStudy() {
        this.watchdogtime = new Date().getTime();
        const _nextStudy = this.getStudyPayload(this.studiesFinished);
        this.logger.debug(`next study`);
        if (_nextStudy) {
            this.sendM(_nextStudy);
        } else {
            this.logger.info(`finished ${this.studiesFinished} studies!`);
            this.stop();
        }
    },
    startSession(auth_token) {
        const self = this;
        this.waitForReadyState(WebSocket.OPEN).then(
            [
                `{"m":"set_auth_token","p":["${auth_token}"]}`,
                `{"m":"chart_create_session","p":["${this.chart_sess}",""]}`,
                `{"m":"quote_create_session","p":["${this.quote_sess}"]}`,
                `{"m":"resolve_symbol","p":["${this.chart_sess}","sds_sym_1","={\\"adjustment\\":\\"splits\\",\\"session\\":\\"regular\\",\\"symbol\\":\\"${chart_symbol}\\"}"]}`,
                `{"m":"create_series","p":["${this.chart_sess}","sds_1","s1","sds_sym_1","${interval}",300,""]}`,
                this.getStudyPayload(this.studiesFinished),
            ].reduce((p, m) => p.then(() => self.sendM(m)), Promise.resolve())
        );
    },
    startSocket(options) {
        const { chart_symbol, interval, end_date } = options;
        const self = this;

        this.logger.warn("starting socket" + JSON.stringify(options));
        this.wss = new WebSocket(`wss://${socket_host}/socket.io/websocket?date=${end_date}`);

        this.wss.onopen = () => self.startSession(auth_token);

        this.wss.onclose = () =>
            self.waitForReadyState(WebSocket.CLOSED).then(() => !self.isStopped() && self.startSocket(options));

        this.watchdogtime = new Date().getTime();
        this.wss.onmessage = (evt) => {
            const received_msg = evt.data;
            self.logger.debug("IN:" + received_msg);
            if (self.isStopped()) {
                self.wss.close();
                return;
            }
            if (received_msg.length < self.hbMessageLen) {
                self.sendM(trimPrefix(received_msg));
            }

            const errResponse = subParagraph(received_msg, "protocol_error", "p");
            if (errResponse) {
                self.logger.warn(`resetting session`);
                //self.wss.close();
                self.startSession(auth_token);
                return;
            }

            if (subParagraph(received_msg, "study_deleted", "}}")) {
                self.nextStudy();
            }

            const report = subParagraph(received_msg, 'performance\\":{', "}}");

            if (report) {
                self.logger.debug("attempting to parse:" + report);
                var parsedReport = JSON.parse(report.replaceAll("\\", "") + "}}");
                self.logger.info(JSON.stringify(parsedReport));
                const oldRes = self.results[JSON.stringify(self.studies[self.studiesFinished].paramCombo).replaceAll('\\"', "")]
                self.results[JSON.stringify(self.studies[self.studiesFinished].paramCombo).replaceAll('\\"', "")] =
                    parsedReport;
                if (!oldRes) {
                    self.studiesFinished++;
                }
                self.sendM(`{"m":"remove_study","p":["${this.chart_sess}","st6"]}`);
            }
            if (new Date().getTime() - self.watchdogtime > self.watchDogPeriod) {
                self.sendM(`{"m":"remove_study","p":["${this.chart_sess}","st6"]}`);
            }
        };
    },
};

// *********** Inputs - You must complete this part *************

// use your own token to authorize script visibility or stay anonymous
const auth_token = "unauthorized_user_token";
// use 'prodata.tradingview.com'  if you're an authentic pro
const socket_host = "data.tradingview.com";

const chart_symbol = "BITSTAMP:BTCUSD";
const interval = "1";
const end_date = "2023_02_21-12_13";

// concurrency on the TV cloud - careful with that one :)
const number_of_runners = 35;

// YOU Must *inspect* a client websocket to find this template for YOUR script
// This will have to be updated any time you update your script source code
// YOU will have manually replace \ with \\ to properly prepare otherwise you will get wrong_data error
//it should look like this `~m~42369~m~{"m":"create_study","p":["cs ..... blah blah ....true,"t":"float"},"in_54":{"v":false,"f":true,"t":"bool"},"__user_pro_plan":{"v":"","f":true,"t":"usertype"},"first_visible_bar_time":{"v":1662634800000,"f":true,"t":"integer"}}]}`
const study_template = `~m~42369~m~{"m":"create_study","p":["cs_9G0fctQJicwg","st6","st1","sds_1","StrategyScript@tv-scripting-101!",{"text":"N2XKSkqNAijkdStzpT0r5g==_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","pineId":"USER;c95272856c71425eb0c6279d792c1022","pineVersion":"984.0","pineFeatures":{"v":"{\\"import\\":1,\\"strategy\\":1,\\"plot\\":1,\\"str\\":1,\\"array\\":1,\\"ta\\":1,\\"math\\":1,\\"alert\\":1,\\"alertcondition\\":1,\\"line\\":1,\\"label\\":1,\\"request.security\\":1}","f":true,"t":"text"},"in_0":{"v":"Close","f":true,"t":"text"},"in_1":{"v":true,"f":true,"t":"bool"},"in_2":{"v":true,"f":true,"t":"bool"},"in_3":{"v":true,"f":true,"t":"bool"},"in_4":{"v":true,"f":true,"t":"bool"},"in_5":{"v":true,"f":true,"t":"bool"},"in_6":{"v":true,"f":true,"t":"bool"},"in_7":{"v":true,"f":true,"t":"bool"},"in_8":{"v":true,"f":true,"t":"bool"},"in_9":{"v":true,"f":true,"t":"bool"},"in_10":{"v":true,"f":true,"t":"bool"},"in_11":{"v":true,"f":true,"t":"bool"},"in_12":{"v":true,"f":true,"t":"bool"},"in_13":{"v":true,"f":true,"t":"bool"},"in_14":{"v":true,"f":true,"t":"bool"},"in_15":{"v":false,"f":true,"t":"bool"},"in_16":{"v":"close","f":true,"t":"source"},"in_17":{"v":1,"f":true,"t":"integer"},"in_18":{"v":20,"f":true,"t":"integer"},"in_19":{"v":20000,"f":true,"t":"integer"},"in_20":{"v":"Hidden","f":true,"t":"text"},"in_21":{"v":1,"f":true,"t":"integer"},"in_22":{"v":43,"f":true,"t":"integer"},"in_23":{"v":"Max","f":true,"t":"text"},"in_24":{"v":true,"f":true,"t":"bool"},"in_25":{"v":75,"f":true,"t":"float"},"in_26":{"v":false,"f":true,"t":"bool"},"in_27":{"v":60,"f":true,"t":"integer"},"in_28":{"v":false,"f":true,"t":"bool"},"in_29":{"v":true,"f":true,"t":"bool"},"in_30":{"v":false,"f":true,"t":"bool"},"in_31":{"v":false,"f":true,"t":"bool"},"in_32":{"v":2.3,"f":true,"t":"float"},"in_33":{"v":false,"f":true,"t":"bool"},"in_34":{"v":"percent_of_equity","f":true,"t":"text"},"in_35":{"v":100,"f":true,"t":"float"},"in_36":{"v":1000,"f":true,"t":"float"},"in_37":{"v":10,"f":true,"t":"float"},"in_38":{"v":10,"f":true,"t":"float"},"in_39":{"v":1,"f":true,"t":"integer"},"in_40":{"v":false,"f":true,"t":"bool"},"in_41":{"v":false,"f":true,"t":"bool"},"in_42":{"v":0,"f":true,"t":"integer"},"in_43":{"v":"NONE","f":true,"t":"text"},"in_44":{"v":0,"f":true,"t":"integer"},"in_45":{"v":"percent","f":true,"t":"text"},"in_46":{"v":0,"f":true,"t":"float"},"in_47":{"v":false,"f":true,"t":"bool"},"in_48":{"v":"FIFO","f":true,"t":"text"},"in_49":{"v":"BACKTEST","f":true,"t":"text"},"in_50":{"v":"","f":true,"t":"text"},"in_51":{"v":"order_fills","f":true,"t":"text"},"in_52":{"v":"","f":true,"t":"text"},"in_53":{"v":2,"f":true,"t":"float"},"in_54":{"v":false,"f":true,"t":"bool"},"__user_pro_plan":{"v":"","f":true,"t":"usertype"},"first_visible_bar_time":{"v":1662634800000,"f":true,"t":"integer"}}]}`;

// variable template - key should match input order in the study starting count from 0
const variable_template = {
    //set parameter 17 to numbers from 1 to 15 increment by 2
    17: range(1, 15, 2),
    //set parameter 20 to "Hidden" for all combinations
    20: ['"Regular"'],
    21: range(2, 5, 1),
    22: range(1, 120, 6),
    25: range(0, 100, 5),
    32: [2.3],
};

// *********** Entry Point - Main ********************8

if (!window.reports) {
    //using a window variable to maintain results between runs
    window.reports = {};
}

const sessionManager = {
    numRunners: number_of_runners,
    results: window.reports,
    prepareStudies(defaultTempl, varTempl) {
        const self = this;
        return cartesian(...Object.values(varTempl)).map((paramCombo) => {
           if (!self.results[JSON.stringify(paramCombo).replaceAll('\\"', "")]) {
               let studyPayload = defaultTempl
                const setStudyInput = (ix, val) => {
                    studyPayload = studyPayload.replace(
                        new RegExp(`in_${ix}":{"v":((?:[^\\,]|\\.)*)`),
                        `in_${ix}":{"v":${val}`
                    );
                };
                Object.keys(varTempl).forEach((key, ix) => setStudyInput(key, paramCombo[ix]));
               return { studyPayload, paramCombo };
            }
            
        }).filter( study  => study)
    },
    setup() {
        const self = this;
        const allstudies = this.prepareStudies(trimPrefix(study_template), variable_template);
        this.sockets = partition(allstudies, allstudies.length / this.numRunners).map((studies, ix) => {
            const sessObj = Object.create(socketContext);
            sessObj.studies = studies;
            sessObj.results = self.results;

            const color = Math.floor(Math.random() * 16777215).toString(16);
            sessObj.logger = {
                info: (m) => console.info("%c [runner-" + ix + "] " + m, `color: #${color}`),
                debug: (m) => console.debug("%c [runner-" + ix + "] " + m, `color: #${color}`),
                warn: (m) => console.warn("%c [runner-" + ix + "] " + m, `color: #${color}`),
            };
            return sessObj;
        });
    },
    start() {
        const self = this;
        this.sockets.forEach((sess, ix) => {
            sess.killflag = false;
            sess.startSocket({
                chart_symbol,
                interval,
                end_date,
            });
        });
    },
    stop() {
        this.sockets.forEach((sess) => sess.stop());
    },
    getResults() {
        return this.results;
    },
    getResultsByMax(criteria)  {
      const results = [];
      Object.keys(window.reports).forEach((ix) => {
        results[i++] = { params: ix, result: window.reports[ix] };
      });
      return results.sort(
        (a, b) => b.result.all[criteria] - a.result.all[criteria]
      );
    }
};

const start = () => {
    sessionManager.setup();
    sessionManager.start();
    return 'Simulation Started!'
}

const stop = () => {
    sessionManager.stop();
    return 'Simulation Stopped.'
}

'Tradingview Strategy Orchestrator - Loaded'

start();
