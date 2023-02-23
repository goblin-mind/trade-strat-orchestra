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
const prepareStudies = (defaultTempl, varTempl) =>
    cartesian(...Object.values(varTempl)).map((paramCombo) => {
        let studyPayload = defaultTempl;

        const setStudyInput = (ix, val) => {
            studyPayload = studyPayload.replace(
                new RegExp(`in_${ix}":{"v":(.*(?!,)),"f`, "g"),
                `in_${ix}":{"v":${val},"f`
            );
        };
        Object.keys(varTempl).forEach((key, ix) => setStudyInput(key, paramCombo[ix]));
        return { studyPayload, paramCombo };
    });

const trimPrefix = (m) => m.match(/~m~.*~m~(.*)/)[1];

// Socket context
const sessionContext = {
    chart_sess: "cs_" + shortRandom(),
    quote_sess: "qs_" + shortRandom(),
    killflag: false,
    rapidFireInterval: 2000,
    hbMessageLen: 20,
    watchDogPeriod: 90000,
    results: [],
    socket_host: "",
    logger: console,
    sendM(m) {
        const length = m.replaceAll("\\\\", "\\").length;
        this.logger.debug(`OUT:~m~${length}~m~${m}`);
        [this.wss.CLOSED, this.wss.CLOSING].indexOf(this.wss.readyState) < 0 && this.wss.send(`~m~${length}~m~${m}`);
    },
    rapidFire(msgs) {
        const self = this;
        msgs.reduce(
            (p, m) =>
                p
                    .then(() => new Promise((resolve) => setTimeout(resolve, self.rapidFireInterval)))
                    .then(() => self.sendM(m)),
            Promise.resolve()
        );
    },
    stop() {
        this.killflag = true;
    },
    isStopped() {
        return this.killflag;
    },
    getStudyPayload(ix) {
        return this.studies[ix].studyPayload.replace(/p":\[("(?:[^"\\]|\\.)*")/, `p":["${this.chart_sess}"`);
    },
    nextStudy() {
        watchdogtime = new Date().getTime();
        const nextStudy = this.getStudyPayload(this.results.length);
        this.logger.warn(`resetting study`);
        if (nextStudy) {
            this.rapidFire([`{"m":"remove_study","p":["${this.chart_sess}","st6"]}`, nextStudy]);
        } else {
            wss.close();
        }
    },
    startSession(options) {
        const { chart_symbol, interval, end_date } = options;
        const self = this;

        this.logger.info("initializing session", options);
        this.wss = new WebSocket(`wss://${socket_host}/socket.io/websocket?date=${end_date}`);
        let watchdogtime = new Date().getTime();

        this.wss.onopen = () =>
            self.rapidFire([
                `{"m":"set_auth_token","p":["${auth_token}"]}`,
                `{"m":"chart_create_session","p":["${self.chart_sess}",""]}`,
                `{"m":"quote_create_session","p":["${self.quote_sess}"]}`,
                `{"m":"resolve_symbol","p":["${self.chart_sess}","sds_sym_1","={\\"adjustment\\":\\"splits\\",\\"session\\":\\"regular\\",\\"symbol\\":\\"${chart_symbol}\\"}"]}`,
                `{"m":"create_series","p":["${self.chart_sess}","sds_1","s1","sds_sym_1","${interval}",300,""]}`,
                self.getStudyPayload(self.results.length),
            ]);

        this.wss.onmessage = (evt) => {
            const received_msg = evt.data;
            self.logger.debug("IN:" + received_msg);
            if (self.isStopped()) {
                self.wss.close();
            }
            if (received_msg.length < self.hbMessageLen) {
                self.sendM(trimPrefix(received_msg));
            }

            const errResponse = subParagraph(received_msg, "protocol_error", "p");
            if (errResponse) {
                self.logger.warn(`resetting socket`);
                self.wss.close();
                self.wss.onclose = () => !self.isStopped() && self.startSession(options);
                return;
            }

            const report = subParagraph(received_msg, 'performance\\":{', "}}");

            if (report) {
                self.logger.debug("attempting to parse:" + report);
                var parsedReport = JSON.parse(report.replaceAll("\\", "") + "}}");
                self.logger.info("parsed:" + parsedReport);
                self.results.push({ parsedReport, params: self.studies[self.results.length].paramCombo });
            }
            if (new Date().getTime() - watchdogtime > self.watchDogPeriod) {
                self.nextStudy();
            }
        };
    },
};

// *********** Inputs - You must complete this part *************

// use your own token to authorize script visibility or stay anonymous
const auth_token = "unauthorized_user_token";
// use 'prodata.tradingview.com'  if you're an authentic pro;
const socket_host = "data.tradingview.com";

const chart_symbol = "BITSTAMP:BTCUSD";
const interval = "60";
const end_date = "2023_02_21-12_13";

// concurrency on the TV cloud - careful with that one :)
const number_of_runners = 5;

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
    window.reports = [];
}

const sessionManager = {
    numSessions: number_of_runners,
    results: window.reports,
    setup() {
        const allstudies = prepareStudies(trimPrefix(study_template), variable_template);
        this.sessions = partition(allstudies, allstudies.length / this.numSessions).map((studies, ix) => {
            const sessObj = Object.create(sessionContext);
            sessObj.studies = studies;
            if (!this.results[ix]) {
                this.results[ix] = [];
            }
            sessObj.results = this.results[ix];
            sessObj.socket_host = socket_host;
            const color = Math.floor(Math.random() * 16777215).toString(16);
            const colorLogger = (m) => console.log("%c " + m, `color: #${color}`);
            sessObj.logger = { info: colorLogger, debug: colorLogger, warn: colorLogger };
            return sessObj;
        });
    },
    start() {
        const self = this;
        this.sessions.forEach((sess, ix) =>
            sess.startSession({
                chart_symbol,
                interval,
                end_date,
            })
        );
    },
    stop() {
        this.sessions.forEach((sess) => sess.stop());
    },
    /*
        Returns a 2d array of parameters and corresponding results
        params:[5, '"Hidden"', 4, 25, 0, 2.3],
        parsedReport: {all: {…}, long: {…}, maxStrategyDrawDown: 635.1133570000002, openPL: -102.501472, buyHoldReturn: -438.03500819999994, …}
    */
    getResults() {
        return this.results;
    },
};

sessionManager.setup();
sessionManager.start();
