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
            this.studies[ix] &&
            this.studies[ix].studyPayload &&
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
                const oldRes =
                    self.results[JSON.stringify(self.studies[self.studiesFinished].paramCombo).replaceAll('\\"', "")];
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
const number_of_runners = 100;

// YOU Must *inspect* a client websocket to find this template for YOUR script
// This will have to be updated any time you update your script source code
// YOU will have manually replace \ with \\ to properly prepare otherwise you will get wrong_data error
//it should look like this `~m~42369~m~{"m":"create_study","p":["cs ..... blah blah ....true,"t":"float"},"in_54":{"v":false,"f":true,"t":"bool"},"__user_pro_plan":{"v":"","f":true,"t":"usertype"},"first_visible_bar_time":{"v":1662634800000,"f":true,"t":"integer"}}]}`
const study_template = `CHANGE_ME`;

// variable template - key should match input order in the study starting count from 0
const variable_template = {
    //set parameter 17 to numbers from 1 to 15 increment by 2
    17: range(1, 15, 2),
    //set parameter 20 to "Hidden" for all combinations
    20: ['"Hidden"'],
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
        return cartesian(...Object.values(varTempl))
            .map((paramCombo) => {
                if (!self.results[JSON.stringify(paramCombo).replaceAll('\\"', "")]) {
                    let studyPayload = defaultTempl;
                    const setStudyInput = (ix, val) => {
                        studyPayload = studyPayload.replace(
                            new RegExp(`in_${ix}":{"v":((?:[^\\,]|\\.)*)`),
                            `in_${ix}":{"v":${val}`
                        );
                    };
                    Object.keys(varTempl).forEach((key, ix) => setStudyInput(key, paramCombo[ix]));
                    return { studyPayload, paramCombo };
                }
            })
            .filter((study) => study);
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
};

const start = () => {
    sessionManager.setup();
    sessionManager.start();
    return "Simulation Started!";
};

const stop = () => {
    sessionManager.stop();
    return "Simulation Stopped.";
};

("Tradingview Strategy Orchestrator - Loaded");

start();
