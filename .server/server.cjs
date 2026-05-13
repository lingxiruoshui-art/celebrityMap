var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_vite = require("vite");
var import_path = __toESM(require("path"), 1);
var import_dotenv = __toESM(require("dotenv"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_node_server = require("@hono/node-server");

// src/app.ts
var import_hono = require("hono");
var import_streaming = require("hono/streaming");
var import_genai = require("@google/genai");

// src/db.ts
var D1DatabaseAdapter = class {
  constructor(d1) {
    this.d1 = d1;
  }
  prepare(sql) {
    const stmt = this.d1.prepare(sql);
    return {
      all: async (...params) => {
        const res = await stmt.bind(...params).all();
        return res.results;
      },
      get: async (...params) => {
        return await stmt.bind(...params).first();
      },
      run: async (...params) => {
        const res = await stmt.bind(...params).run();
        return { changes: res.meta.changes, lastInsertRowid: res.meta.last_row_id };
      }
    };
  }
  async exec(sql) {
    await this.d1.exec(sql);
  }
  pragma(sql) {
  }
};

// src/figuresPool.ts
var CATEGORIES = [
  "\u54F2\u5B66\u5BB6",
  "\u827A\u672F\u5BB6",
  "\u79D1\u5B66\u5BB6/\u6570\u5B66\u5BB6",
  "\u53D1\u660E\u5BB6",
  "\u653F\u6CBB\u5BB6/\u541B\u4E3B",
  "\u519B\u4E8B\u5BB6",
  "\u601D\u60F3\u5BB6/\u6559\u80B2\u5BB6",
  "\u6587\u5B66\u5BB6/\u4F5C\u5BB6",
  "\u8BD7\u4EBA",
  "\u97F3\u4E50\u5BB6/\u4F5C\u66F2\u5BB6",
  "\u6B4C\u624B/\u6F14\u827A\u660E\u661F",
  "\u63A2\u9669\u5BB6/\u822A\u6D77\u5BB6",
  "\u5546\u4E1A\u7CBE\u82F1/\u4F01\u4E1A\u5BB6",
  "\u533B\u5B66\u5BB6",
  "\u5176\u4ED6\u5386\u53F2\u540D\u4EBA"
];
var FIGURE_POOL = {
  "\u54F2\u5B66\u5BB6": [
    "\u82CF\u683C\u62C9\u5E95",
    "\u67CF\u62C9\u56FE",
    "\u4E9A\u91CC\u58EB\u591A\u5FB7",
    "\u5EB7\u5FB7",
    "\u9A6C\u514B\u601D",
    "\u5C3C\u91C7",
    "\u9ED1\u683C\u5C14",
    "\u5362\u68AD",
    "\u7B1B\u5361\u5C14",
    "\u4F0F\u5C14\u6CF0",
    "\u7EA6\u7FF0\xB7\u6D1B\u514B",
    "\u5927\u536B\xB7\u4F11\u8C1F",
    "\u53D4\u672C\u534E",
    "\u57F9\u6839",
    "\u7F57\u7D20",
    "\u7EF4\u7279\u6839\u65AF\u5766",
    "\u8428\u7279",
    "\u6D77\u5FB7\u683C\u5C14",
    "\u798F\u67EF",
    "\u9A6C\u57FA\u96C5\u7EF4\u5229",
    "\u5965\u53E4\u65AF\u4E01",
    "\u6258\u9A6C\u65AF\xB7\u963F\u594E\u90A3",
    "\u65AF\u5BBE\u8BFA\u838E",
    "\u5B5F\u5FB7\u65AF\u9E20",
    "\u4E9A\u5F53\xB7\u65AF\u5BC6",
    "\u9A6C\u514B\u65AF\xB7\u97E6\u4F2F",
    "\u9F50\u514B\u679C",
    "\u5E15\u65AF\u5361",
    "\u7EA6\u7FF0\xB7\u5BC6\u5C14",
    "\u675C\u5A01",
    "\u80E1\u585E\u5C14",
    "\u6069\u683C\u65AF",
    "\u8D39\u5C14\u5DF4\u54C8",
    "\u5361\u5C14\xB7\u6CE2\u666E\u5C14",
    "\u6258\u9A6C\u65AF\xB7\u5E93\u6069",
    "\u5A01\u5EC9\xB7\u8A79\u59C6\u65AF",
    "\u5FB7\u91CC\u8FBE",
    "\u585E\u6D85\u5361",
    "\u72C4\u5FB7\u7F57",
    "\u8D39\u5E0C\u7279",
    "\u8C22\u6797",
    "\u6BD5\u8FBE\u54E5\u62C9\u65AF",
    "\u8D6B\u62C9\u514B\u5229\u7279",
    "\u5DF4\u95E8\u5C3C\u5FB7",
    "\u5FB7\u8C1F\u514B\u5229\u7279",
    "\u829D\u8BFA",
    "\u4F0A\u58C1\u9E20\u9C81",
    "\u7B2C\u6B27\u6839\u5C3C",
    "\u9A6C\u5C14\u5E93\u65AF\xB7\u5965\u52D2\u7559",
    "\u963F\u5C14\u8D1D\u7279\xB7\u53F2\u6000\u54F2",
    "\u7231\u6BD4\u514B\u6CF0\u5FB7"
  ],
  "\u601D\u60F3\u5BB6/\u6559\u80B2\u5BB6": [
    "\u5B54\u5B50",
    "\u8001\u5B50",
    "\u5B5F\u5B50",
    "\u5E84\u5B50",
    "\u5B59\u5B50",
    "\u97E9\u975E\u5B50",
    "\u8340\u5B50",
    "\u58A8\u5B50",
    "\u6731\u71B9",
    "\u738B\u9633\u660E",
    "\u8463\u4EF2\u8212",
    "\u738B\u592B\u4E4B",
    "\u5F20\u8F7D",
    "\u987E\u708E\u6B66",
    "\u9EC4\u5B97\u7FB2",
    "\u738B\u5145",
    "\u6881\u542F\u8D85",
    "\u4E25\u590D",
    "\u7AE0\u592A\u708E",
    "\u51AF\u53CB\u5170",
    "\u91D1\u5CB3\u9716",
    "\u718A\u5341\u529B",
    "\u6881\u6F31\u6E9F",
    "\u80E1\u9002",
    "\u6167\u80FD",
    "\u7384\u5958",
    "\u738B\u5F3C",
    "\u7A0B\u98A2",
    "\u7A0B\u9890",
    "\u9646\u4E5D\u6E0A",
    "\u5D47\u5EB7",
    "\u674E\u65AF",
    "\u725F\u5B97\u4E09",
    "\u5510\u541B\u6BC5",
    "\u8D39\u5B5D\u901A",
    "\u5217\u5B50",
    "\u516C\u5B59\u9F99",
    "\u5409\u85CF",
    "\u738B\u56FD\u7EF4",
    "\u8521\u5143\u57F9",
    "\u9676\u884C\u77E5",
    "\u739B\u4E3D\u4E9A\xB7\u8499\u53F0\u68AD\u5229"
  ],
  "\u827A\u672F\u5BB6": [
    "\u8FBE\u82AC\u5947",
    "\u7C73\u5F00\u6717\u57FA\u7F57",
    "\u68B5\u9AD8",
    "\u6BD5\u52A0\u7D22",
    "\u83AB\u5948",
    "\u62C9\u6590\u5C14",
    "\u4F26\u52C3\u6717",
    "\u7F57\u4E39",
    "\u585E\u5C1A",
    "\u9AD8\u66F4",
    "\u8FBE\u5229",
    "\u96F7\u8BFA\u963F",
    "\u5B89\u8FEA\xB7\u6C83\u970D\u5C14",
    "\u6CE2\u63D0\u5207\u5229",
    "\u63D0\u9999",
    "\u4E22\u52D2",
    "\u9C81\u672C\u65AF",
    "\u59D4\u62C9\u65AF\u5F00\u5179",
    "\u6208\u96C5",
    "\u9A6C\u5948",
    "\u8D1D\u5C3C\u5C3C",
    "\u7EF4\u7C73\u5C14",
    "\u5361\u62C9\u74E6\u4E54",
    "\u514B\u91CC\u59C6\u7279",
    "\u5EB7\u5B9A\u65AF\u57FA",
    "\u590F\u52A0\u5C14",
    "\u6CE2\u6D1B\u514B",
    "\u5F17\u91CC\u8FBE\xB7\u5361\u7F57",
    "\u9A6C\u683C\u5229\u7279",
    "\u96C5\u514B-\u8DEF\u6613\xB7\u5927\u536B",
    "\u5B89\u4E1C\u5C3C\xB7\u9AD8\u8FEA",
    "\u52D2\xB7\u67EF\u5E03\u897F\u8036",
    "\u53EF\u53EF\xB7\u9999\u5948\u513F",
    "\u514B\u91CC\u65AF\u6C40\xB7\u8FEA\u5965",
    "\u4F0A\u592B\xB7\u5723\u7F57\u5170",
    "\u4E9A\u5386\u5C71\u5927\xB7\u9EA6\u6606",
    "\u9F50\u767D\u77F3",
    "\u5F20\u5927\u5343",
    "\u5F90\u60B2\u9E3F",
    "\u738B\u7FB2\u4E4B",
    "\u5510\u5BC5",
    "\u5434\u9053\u5B50",
    "\u987E\u607A\u4E4B",
    "\u5F20\u62E9\u7AEF",
    "\u90D1\u677F\u6865",
    "\u516B\u5927\u5C71\u4EBA",
    "\u77F3\u6D9B",
    "\u5434\u51A0\u4E2D",
    "\u989C\u771F\u537F",
    "\u67F3\u516C\u6743",
    "\u8463\u5176\u660C",
    "\u6587\u5FB5\u660E",
    "\u8303\u5BBD",
    "\u9EC4\u5BBE\u8679",
    "\u5434\u660C\u7855",
    "\u674E\u53EF\u67D3",
    "\u5085\u62B1\u77F3",
    "\u6797\u98CE\u7720",
    "\u6F58\u5929\u5BFF",
    "\u848B\u5146\u548C",
    "\u8D75\u65E0\u6781",
    "\u6731\u5FB7\u7FA4",
    "\u5F20\u65ED",
    "\u4E30\u5B50\u607A",
    "\u674E\u53D4\u540C",
    "\u5218\u6D77\u7C9F",
    "\u960E\u7ACB\u672C"
  ],
  "\u79D1\u5B66\u5BB6/\u6570\u5B66\u5BB6": [
    "\u725B\u987F",
    "\u7231\u56E0\u65AF\u5766",
    "\u4F3D\u5229\u7565",
    "\u963F\u57FA\u7C73\u5FB7",
    "\u8FBE\u5C14\u6587",
    "\u54E5\u767D\u5C3C",
    "\u5C45\u91CC\u592B\u4EBA",
    "\u6CD5\u62C9\u7B2C",
    "\u9EA6\u514B\u65AF\u97E6",
    "\u8DEF\u6613\u65AF\xB7\u5DF4\u65AF\u5FB7",
    "\u95E8\u6377\u5217\u592B",
    "\u56FE\u7075",
    "\u9AD8\u65AF",
    "\u6B27\u62C9",
    "\u666E\u6717\u514B",
    "\u859B\u5B9A\u8C14",
    "\u6CE2\u5C14",
    "\u5362\u745F\u798F",
    "\u5F00\u666E\u52D2",
    "\u62C9\u74E6\u9521",
    "\u6B27\u51E0\u91CC\u5F97",
    "\u9ECE\u66FC",
    "\u83B1\u5E03\u5C3C\u8328",
    "\u51AF\xB7\u8BFA\u4F9D\u66FC",
    "\u72C4\u62C9\u514B",
    "\u8D39\u66FC",
    "\u6D77\u68EE\u5821",
    "\u8D39\u7C73",
    "\u5E9E\u52A0\u83B1",
    "\u514B\u52B3\u5FB7\xB7\u9999\u519C",
    "\u54C8\u52C3",
    "\u54C8\u7EF4",
    "\u73BB\u5C14\u5179\u66FC",
    "\u62C9\u683C\u6717\u65E5",
    "\u62C9\u666E\u62C9\u65AF",
    "\u8D39\u9A6C",
    "\u62C9\u9A6C\u52AA\u91D1",
    "\u5B5F\u5FB7\u5C14",
    "\u6258\u52D2\u5BC6",
    "\u7F57\u4F2F\u7279\xB7\u80E1\u514B",
    "\u5361\u5C14\xB7\u8428\u6839",
    "\u73CD\xB7\u53E4\u9053\u5C14",
    "\u5F20\u8861",
    "\u7956\u51B2\u4E4B",
    "\u6C88\u62EC",
    "\u90ED\u5B88\u656C",
    "\u5F90\u5149\u542F",
    "\u5218\u5FBD",
    "\u5434\u5065\u96C4",
    "\u94B1\u5B66\u68EE",
    "\u534E\u7F57\u5E9A",
    "\u9093\u7A3C\u5148",
    "\u9648\u666F\u6DA6",
    "\u94B1\u4E09\u5F3A",
    "\u674E\u56DB\u5149",
    "\u8881\u9686\u5E73",
    "\u7AFA\u53EF\u6862",
    "\u9648\u7701\u8EAB",
    "\u82CF\u6B65\u9752",
    "\u5434\u5B5F\u8D85",
    "\u90ED\u6C38\u6000",
    "\u738B\u6DE6\u660C",
    "\u6731\u5149\u4E9A",
    "\u8305\u4EE5\u5347",
    "\u53F6\u4F01\u5B59",
    "\u5434\u6709\u8BAD",
    "\u6768\u8F89",
    "\u4E00\u884C",
    "\u8D3E\u601D\u52F0",
    "\u5B8B\u5E94\u661F",
    "\u674E\u5584\u5170",
    "\u7A0B\u5927\u4F4D",
    "\u8D75\u723D",
    "\u5965\u672C\u6D77\u9ED8"
  ],
  "\u53D1\u660E\u5BB6": [
    "\u7231\u8FEA\u751F",
    "\u74E6\u7279",
    "\u83B1\u7279\u5144\u5F1F",
    "\u53E4\u817E\u5821",
    "\u8D1D\u5C14",
    "\u7279\u65AF\u62C9",
    "\u8BFA\u8D1D\u5C14",
    "\u5361\u5C14\xB7\u672C\u8328",
    "\u4EA8\u5229\xB7\u798F\u7279",
    "\u5BCC\u5170\u514B\u6797",
    "\u6234\u59C6\u52D2",
    "\u9A6C\u53EF\u5C3C",
    "\u5362\u7C73\u57C3\u5C14\u5144\u5F1F",
    "\u8521\u4F26",
    "\u6BD5\u5347",
    "\u9C81\u73ED",
    "\u9EC4\u9053\u5A46",
    "\u674E\u51B0",
    "\u4FAF\u5FB7\u699C",
    "\u738B\u9009",
    "\u51AF\u5982"
  ],
  "\u653F\u6CBB\u5BB6/\u541B\u4E3B": [
    "\u79E6\u59CB\u7687",
    "\u6C49\u6B66\u5E1D",
    "\u5510\u592A\u5B97",
    "\u6210\u5409\u601D\u6C57",
    "\u6731\u5143\u748B",
    "\u6B66\u5219\u5929",
    "\u66F9\u64CD",
    "\u5218\u90A6",
    "\u8BF8\u845B\u4EAE",
    "\u5B59\u4E2D\u5C71",
    "\u5EB7\u7199",
    "\u4E7E\u9686",
    "\u6731\u68E3",
    "\u5510\u7384\u5B97",
    "\u6148\u79A7",
    "\u5546\u9785",
    "\u5F20\u5C45\u6B63",
    "\u53F8\u9A6C\u8FC1",
    "\u6797\u5219\u5F90",
    "\u66FE\u56FD\u85E9",
    "\u674E\u9E3F\u7AE0",
    "\u90D1\u6210\u529F",
    "\u5F20\u9A9E",
    "\u9B4F\u5F81",
    "\u72C4\u4EC1\u6770",
    "\u5305\u62EF",
    "\u6D77\u745E",
    "\u5FFD\u5FC5\u70C8",
    "\u5B8B\u592A\u7956",
    "\u5218\u5907",
    "\u5B59\u6743",
    "\u53F8\u9A6C\u61FF",
    "\u53F8\u9A6C\u5149",
    "\u8303\u4EF2\u6DF9",
    "\u738B\u83BD",
    "\u8D75\u5321\u80E4",
    "\u96CD\u6B63",
    "\u5B8B\u4E30\u7F8E",
    "\u62FF\u7834\u4ED1",
    "\u4E9A\u5386\u5C71\u5927\u5927\u5E1D",
    "\u51EF\u6492",
    "\u534E\u76DB\u987F",
    "\u6797\u80AF",
    "\u65AF\u5927\u6797",
    "\u4E18\u5409\u5C14",
    "\u5BCC\u5170\u514B\u6797\xB7\u7F57\u65AF\u798F",
    "\u5217\u5B81",
    "\u5F7C\u5F97\u5927\u5E1D",
    "\u7518\u5730",
    "\u9A6C\u4E01\xB7\u8DEF\u5FB7\xB7\u91D1",
    "\u66FC\u5FB7\u62C9",
    "\u7EF4\u591A\u5229\u4E9A\u5973\u738B",
    "\u4F0A\u4E3D\u838E\u767D\u4E00\u4E16",
    "\u53F6\u5361\u6377\u7433\u5A1C\u4E8C\u4E16",
    "\u514B\u5229\u5965\u5E15\u7279\u62C9",
    "\u67E5\u7406\u66FC",
    "\u8DEF\u6613\u5341\u56DB",
    "\u4FFE\u65AF\u9EA6",
    "\u4E9A\u5386\u5C71\u5927\xB7\u6C49\u5BC6\u5C14\u987F",
    "\u514B\u4F26\u5A01\u5C14",
    "\u51EF\u672B\u5C14",
    "\u6234\u9AD8\u4E50",
    "\u80E1\u5FD7\u660E",
    "\u7EA6\u745F\u666E\xB7\u5E03\u7F57\u5179\xB7\u94C1\u6258",
    "\u7EA6\u7FF0\xB7\u6885\u7EB3\u5FB7\xB7\u51EF\u6069\u65AF"
  ],
  "\u519B\u4E8B\u5BB6": [
    "\u5CB3\u98DE",
    "\u9879\u7FBD",
    "\u97E9\u4FE1",
    "\u536B\u9752",
    "\u970D\u53BB\u75C5",
    "\u5F20\u826F",
    "\u767D\u8D77",
    "\u674E\u9756",
    "\u621A\u7EE7\u5149",
    "\u6587\u5929\u7965",
    "\u5DE6\u5B97\u68E0",
    "\u5173\u7FBD",
    "\u5468\u745C",
    "\u5F20\u98DE",
    "\u8D75\u4E91",
    "\u9A6C\u8D85",
    "\u9EC4\u5FE0",
    "\u9C81\u8083",
    "\u5415\u8499",
    "\u9646\u900A",
    "\u8881\u5D07\u7115",
    "\u6768\u5BB6\u5C06",
    "\u82B1\u6728\u5170",
    "\u6731\u53EF\u592B",
    "\u9686\u7F8E\u5C14",
    "\u5DF4\u987F",
    "\u9EA6\u514B\u963F\u745F",
    "\u8499\u54E5\u9A6C\u5229",
    "\u6C49\u5C3C\u62D4",
    "\u8428\u62C9\u4E01",
    "\u5723\u5973\u8D1E\u5FB7",
    "\u5207\xB7\u683C\u74E6\u62C9"
  ],
  "\u8BD7\u4EBA": [
    "\u838E\u58EB\u6BD4\u4E9A",
    "\u6CF0\u6208\u5C14",
    "\u4F46\u4E01",
    "\u6B4C\u5FB7",
    "\u666E\u5E0C\u91D1",
    "\u62DC\u4F26",
    "\u96EA\u83B1",
    "\u8377\u9A6C",
    "\u60E0\u7279\u66FC",
    "\u53F6\u829D",
    "\u827E\u7565\u7279",
    "\u6CE2\u5FB7\u83B1\u5C14",
    "\u6D4E\u6148",
    "\u72C4\u91D1\u68EE",
    "\u6D77\u6D85",
    "\u8042\u9C81\u8FBE",
    "\u5170\u6CE2",
    "\u7EF4\u5409\u5C14",
    "\u674E\u767D",
    "\u675C\u752B",
    "\u5C48\u539F",
    "\u82CF\u8F7C",
    "\u767D\u5C45\u6613",
    "\u738B\u7EF4",
    "\u674E\u6E05\u7167",
    "\u9676\u6E0A\u660E",
    "\u674E\u5546\u9690",
    "\u675C\u7267",
    "\u9646\u6E38",
    "\u8F9B\u5F03\u75BE",
    "\u674E\u715C",
    "\u66F9\u690D",
    "\u738B\u660C\u9F84",
    "\u5B5F\u6D69\u7136",
    "\u738B\u52C3",
    "\u97E9\u6108",
    "\u6B27\u9633\u4FEE",
    "\u7EB3\u5170\u6027\u5FB7",
    "\u9F9A\u81EA\u73CD",
    "\u5F90\u5FD7\u6469",
    "\u95FB\u4E00\u591A",
    "\u90ED\u6CAB\u82E5",
    "\u827E\u9752",
    "\u6D77\u5B50",
    "\u987E\u57CE",
    "\u6234\u671B\u8212",
    "\u674E\u8D3A",
    "\u5143\u7A39",
    "\u5C91\u53C2",
    "\u9AD8\u9002",
    "\u738B\u4E4B\u6DA3",
    "\u9A86\u5BBE\u738B",
    "\u5218\u79B9\u9521",
    "\u66F9\u4E15",
    "\u962E\u7C4D",
    "\u81E7\u514B\u5BB6",
    "\u9648\u5BC5\u606A"
  ],
  "\u6587\u5B66\u5BB6/\u4F5C\u5BB6": [
    "\u6258\u5C14\u65AF\u6CF0",
    "\u96E8\u679C",
    "\u6D77\u660E\u5A01",
    "\u72C4\u66F4\u65AF",
    "\u9A6C\u514B\xB7\u5410\u6E29",
    "\u5DF4\u5C14\u624E\u514B",
    "\u9640\u601D\u59A5\u8036\u592B\u65AF\u57FA",
    "\u5951\u8BC3\u592B",
    "\u585E\u4E07\u63D0\u65AF",
    "\u4E54\u6CBB\xB7\u5965\u5A01\u5C14",
    "\u52A0\u7F2A",
    "\u5361\u592B\u5361",
    "\u798F\u514B\u7EB3",
    "\u6BDB\u59C6",
    "\u9A6C\u5C14\u514B\u65AF",
    "\u666E\u9C81\u65AF\u7279",
    "\u7B80\xB7\u5965\u65AF\u6C40",
    "\u5B89\u5F92\u751F",
    "\u5927\u4EF2\u9A6C",
    "\u5C0F\u4EF2\u9A6C",
    "\u5112\u52D2\xB7\u51E1\u5C14\u7EB3",
    "\u5965\u65AF\u5361\xB7\u738B\u5C14\u5FB7",
    "\u53F8\u6C64\u8FBE",
    "\u798F\u697C\u62DC",
    "\u8427\u4F2F\u7EB3",
    "\u6613\u535C\u751F",
    "\u83AB\u91CC\u54C0",
    "\u5F17\u5409\u5C3C\u4E9A\xB7\u4F0D\u5C14\u592B",
    "\u9ED1\u585E",
    "\u7EB3\u535A\u79D1\u592B",
    "\u679C\u6208\u91CC",
    "\u5C60\u683C\u6D85\u592B",
    "\u963F\u52A0\u838E\xB7\u514B\u91CC\u65AF\u8482",
    "\u5DDD\u7AEF\u5EB7\u6210",
    "\u4E09\u5C9B\u7531\u7EAA\u592B",
    "\u592A\u5BB0\u6CBB",
    "\u82A5\u5DDD\u9F99\u4E4B\u4ECB",
    "\u7D22\u5C14\u4EC1\u5C3C\u7434",
    "\u535A\u5C14\u8D6B\u65AF",
    "\u827E\u8428\u514B\xB7\u963F\u897F\u83AB\u592B",
    "H\xB7G\xB7\u5A01\u5C14\u65AF",
    "\u8D5B\u73CD\u73E0",
    "\u590F\u6D1B\u8482\xB7\u52C3\u6717\u7279",
    "\u827E\u7C73\u8389\xB7\u52C3\u6717\u7279",
    "\u7231\u4F26\xB7\u5761",
    "\u9C81\u8FC5",
    "\u66F9\u96EA\u82B9",
    "\u65BD\u8010\u5EB5",
    "\u7F57\u8D2F\u4E2D",
    "\u5434\u627F\u6069",
    "\u84B2\u677E\u9F84",
    "\u8001\u820D",
    "\u5DF4\u91D1",
    "\u91D1\u5EB8",
    "\u6C88\u4ECE\u6587",
    "\u94B1\u949F\u4E66",
    "\u5F20\u7231\u73B2",
    "\u8305\u76FE",
    "\u6797\u8BED\u5802",
    "\u5173\u6C49\u537F",
    "\u6C64\u663E\u7956",
    "\u5434\u656C\u6893",
    "\u51AF\u68A6\u9F99",
    "\u8DEF\u9065",
    "\u6C6A\u66FE\u797A",
    "\u51B0\u5FC3",
    "\u4E09\u6BDB",
    "\u53E4\u9F99",
    "\u6881\u7FBD\u751F",
    "\u738B\u5C0F\u6CE2",
    "\u53F2\u94C1\u751F",
    "\u9648\u5FE0\u5B9E",
    "\u59DA\u96EA\u57A0"
  ],
  "\u97F3\u4E50\u5BB6/\u4F5C\u66F2\u5BB6": [
    "\u8D1D\u591A\u82AC",
    "\u83AB\u624E\u7279",
    "\u5DF4\u8D6B",
    "\u8096\u90A6",
    "\u67F4\u53EF\u592B\u65AF\u57FA",
    "\u674E\u65AF\u7279",
    "\u8212\u4F2F\u7279",
    "\u52C3\u62C9\u59C6\u65AF",
    "\u6D77\u987F",
    "\u4EA8\u5FB7\u5C14",
    "\u7EF4\u74E6\u5C14\u7B2C",
    "\u7EA6\u7FF0\xB7\u65BD\u7279\u52B3\u65AF",
    "\u8212\u66FC",
    "\u5FB7\u6C83\u590F\u514B",
    "\u95E8\u5FB7\u5C14\u677E",
    "\u74E6\u683C\u7EB3",
    "\u5A01\u5C14\u7B2C",
    "\u666E\u5951\u5C3C",
    "\u62C9\u8D6B\u739B\u5C3C\u8BFA\u592B",
    "\u5FB7\u5F6A\u897F",
    "\u62C9\u5A01\u5C14",
    "\u5E15\u683C\u5C3C\u5C3C",
    "\u9A6C\u52D2",
    "\u7406\u67E5\u5FB7\xB7\u65BD\u7279\u52B3\u65AF",
    "\u683C\u4EC0\u6E29",
    "\u4F2F\u6069\u65AF\u5766",
    "\u5361\u62C9\u626C",
    "\u7F57\u897F\u5C3C",
    "\u7A46\u7D22\u5C14\u65AF\u57FA",
    "\u91CC\u59C6\u65AF\u57FA-\u79D1\u8428\u79D1\u592B",
    "\u666E\u7F57\u79D1\u83F2\u8036\u592B",
    "\u5C3C\u8BFA\xB7\u7F57\u5854",
    "\u7EA6\u7FF0\xB7\u5DF4\u91CC",
    "\u51BC\u661F\u6D77",
    "\u8042\u8033",
    "\u963F\u70B3",
    "\u5218\u5929\u534E",
    "\u738B\u6D1B\u5BBE",
    "\u8D3A\u7EFF\u6C40",
    "\u9EC4\u81EA",
    "\u9A6C\u601D\u806A",
    "\u65BD\u5149\u5357",
    "\u90D1\u5F8B\u6210",
    "\u674E\u7115\u4E4B",
    "\u9ECE\u9526\u6656"
  ],
  "\u6B4C\u624B/\u6F14\u827A\u660E\u661F": [
    "\u8FC8\u514B\u5C14\xB7\u6770\u514B\u900A",
    "\u732B\u738B",
    "\u7EA6\u7FF0\xB7\u5217\u4FAC",
    "\u5E15\u74E6\u7F57\u8482",
    "\u60E0\u7279\u5C3C\xB7\u4F11\u65AF\u987F",
    "\u5F17\u96F7\u8FEA\xB7\u9ED8\u4E18\u91CC",
    "\u739B\u4E3D\u4E9A\xB7\u5361\u62C9\u65AF",
    "\u9C8D\u52C3\xB7\u9A6C\u5229",
    "\u8DEF\u6613\u65AF\xB7\u963F\u59C6\u65AF\u7279\u6717",
    "\u5927\u536B\xB7\u9C8D\u4F0A",
    "\u5F17\u5170\u514B\xB7\u8F9B\u7EB3\u5C48",
    "\u79D1\u7279\xB7\u67EF\u672C",
    "\u827E\u7C73\xB7\u6000\u6069\u8C6A\u65AF",
    "\u56FE\u6D3E\u514B",
    "\u5353\u522B\u6797",
    "\u5965\u9EDB\u4E3D\xB7\u8D6B\u672C",
    "\u739B\u4E3D\u83B2\xB7\u68A6\u9732",
    "\u8D39\u96EF\xB7\u4E3D",
    "\u5E0C\u533A\u67EF\u514B",
    "\u9ED1\u6CFD\u660E",
    "\u65AF\u5766\u5229\xB7\u5E93\u5E03\u91CC\u514B",
    "\u963F\u5170\xB7\u5FB7\u9F99",
    "\u51EF\u745F\u7433\xB7\u8D6B\u672C",
    "\u4F0A\u4E3D\u838E\u767D\xB7\u6CF0\u52D2",
    "\u514B\u62C9\u514B\xB7\u76D6\u535A",
    "\u845B\u4E3D\u6CF0\xB7\u5609\u5B9D",
    "\u5E0C\u65AF\xB7\u83B1\u6770",
    "\u674E\u5C0F\u9F99",
    "\u6885\u5170\u82B3",
    "\u9093\u4E3D\u541B",
    "\u9EC4\u5BB6\u9A79",
    "\u5F20\u56FD\u8363",
    "\u6885\u8273\u82B3"
  ],
  "\u63A2\u9669\u5BB6/\u822A\u6D77\u5BB6": [
    "\u54E5\u4F26\u5E03",
    "\u9EA6\u54F2\u4F26",
    "\u9A6C\u53EF\xB7\u6CE2\u7F57",
    "\u8FBE\xB7\u4F3D\u9A6C",
    "\u8A79\u59C6\u65AF\xB7\u5E93\u514B",
    "\u90D1\u548C",
    "\u5F90\u971E\u5BA2",
    "\u7384\u5958",
    "\u9274\u771F",
    "\u963F\u8499\u68EE",
    "\u65AF\u79D1\u7279",
    "\u5E0C\u62C9\u91CC"
  ],
  "\u5546\u4E1A\u7CBE\u82F1/\u4F01\u4E1A\u5BB6": [
    "\u6D1B\u514B\u83F2\u52D2",
    "\u7F57\u65AF\u67F4\u5C14\u5FB7",
    "\u5361\u5185\u57FA",
    "\u4EA8\u5229\xB7\u798F\u7279",
    "\u6BD4\u5C14\xB7\u76D6\u8328",
    "\u53F2\u8482\u592B\xB7\u4E54\u5E03\u65AF",
    "\u57C3\u9686\xB7\u9A6C\u65AF\u514B",
    "\u6C83\u4F26\xB7\u5DF4\u83F2\u7279",
    "\u80E1\u96EA\u5CA9",
    "\u6C88\u4E07\u4E09",
    "\u76DB\u5BA3\u6000",
    "\u5F20\u8B07"
  ],
  "\u533B\u5B66\u5BB6": [
    "\u674E\u65F6\u73CD",
    "\u534E\u4F57",
    "\u5F20\u4EF2\u666F",
    "\u5B59\u601D\u9088",
    "\u6241\u9E4A",
    "\u845B\u6D2A",
    "\u8DEF\u6613\u65AF\xB7\u5DF4\u65AF\u5FB7",
    "\u5F17\u83B1\u660E",
    "\u5357\u4E01\u683C\u5C14",
    "\u6797\u5DE7\u7A1A",
    "\u767D\u6C42\u6069"
  ],
  "\u5176\u4ED6\u5386\u53F2\u540D\u4EBA": [
    "\u548C\u73C5",
    "\u7EAA\u6653\u5C9A",
    "\u5218\u5889",
    "\u675C\u6708\u7B19",
    "\u9EC4\u91D1\u8363",
    "\u738B\u662D\u541B",
    "\u6768\u8D35\u5983",
    "\u897F\u65BD",
    "\u8C82\u8749",
    "\u8521\u6587\u59EC",
    "\u4E0A\u5B98\u5A49\u513F",
    "\u82B1\u6728\u5170",
    "\u6D77\u4F26\xB7\u51EF\u52D2",
    "\u7EA6\u7FF0\xB7\u51EF\u6069\u65AF",
    "\u5361\u5C14\xB7\u8363\u683C",
    "\u5F17\u6D1B\u4F0A\u5FB7"
  ]
};

// src/app.ts
var app = new import_hono.Hono().basePath("/api");
var dbInitialized = false;
async function getDb(c) {
  let db2;
  if (c.env && c.env.DB_ADAPTER) {
    db2 = c.env.DB_ADAPTER;
  } else if (c.env && c.env.DB) {
    db2 = new D1DatabaseAdapter(c.env.DB);
  } else {
    throw new Error("No database adapter provided");
  }
  if (!dbInitialized) {
    await db2.exec(`
      CREATE TABLE IF NOT EXISTS people (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        category TEXT NOT NULL,
        keyword TEXT,
        lifespan TEXT,
        birthplace TEXT,
        biography TEXT NOT NULL,
        achievements TEXT NOT NULL,
        image_url TEXT,
        views INTEGER DEFAULT 0,
        raw_relationships TEXT DEFAULT '[]',
        latitude REAL DEFAULT 0,
        longitude REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS relationships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        person1_id INTEGER NOT NULL,
        person2_id INTEGER NOT NULL,
        relationship_type TEXT NOT NULL,
        FOREIGN KEY(person1_id) REFERENCES people(id),
        FOREIGN KEY(person2_id) REFERENCES people(id),
        UNIQUE(person1_id, person2_id)
      );

      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS guest_usage (
        ip TEXT,
        date TEXT,
        count INTEGER,
        PRIMARY KEY(ip, date)
      );
    `);
    const migrations = [
      "ALTER TABLE people ADD COLUMN latitude REAL DEFAULT 0",
      "ALTER TABLE people ADD COLUMN longitude REAL DEFAULT 0",
      "ALTER TABLE people ADD COLUMN image_url TEXT",
      "ALTER TABLE people ADD COLUMN lifespan TEXT",
      "ALTER TABLE people ADD COLUMN birthplace TEXT"
    ];
    for (const m of migrations) {
      try {
        await db2.exec(m);
      } catch (e) {
      }
    }
    dbInitialized = true;
  }
  return db2;
}
var getConfig = async (db2, key, defaultValue = "") => {
  const row = await db2.prepare("SELECT value FROM config WHERE key = ?").get(key);
  if (!row || row.value === null || row.value === void 0) return defaultValue;
  return String(row.value);
};
var setConfig = async (db2, key, value) => {
  await db2.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
};
function getCSTDate() {
  const now = /* @__PURE__ */ new Date();
  const utcTime = now.getTime() + now.getTimezoneOffset() * 6e4;
  const cstTime = new Date(utcTime + 8 * 36e5);
  return cstTime.toISOString().split("T")[0];
}
async function getRemainingQuota(db2) {
  const limit = parseInt(await getConfig(db2, "guest_explore_limit", "5"), 10);
  const date = getCSTDate();
  const row = await db2.prepare("SELECT count FROM guest_usage WHERE ip = 'GLOBAL_GUEST' AND date = ?").get(date);
  const used = row ? row.count : 0;
  return Math.max(0, limit - used);
}
async function incrementUsage(db2) {
  const date = getCSTDate();
  await db2.prepare(`
        INSERT INTO guest_usage (ip, date, count) 
        VALUES ('GLOBAL_GUEST', ?, 1) 
        ON CONFLICT(ip, date) DO UPDATE SET count = count + 1
    `).run(date);
}
var getAdminPassword = (c) => {
  return c.env && c.env.ADMIN_PASSWORD || typeof process !== "undefined" && process.env.ADMIN_PASSWORD || "admin";
};
async function callAI(c, db2, prompt, responseFormat = "text", schema) {
  const provider = await getConfig(db2, "active_model_provider", "gemini");
  if (provider === "aliyun") {
    const apiKey = await getConfig(db2, "aliyun_api_key");
    const modelId = await getConfig(db2, "aliyun_model_id");
    if (!apiKey) throw new Error("\u7F3A\u5C11 Aliyun API Key");
    if (!modelId) throw new Error("\u7F3A\u5C11 Aliyun \u6A21\u578B ID");
    const systemContent = `\u4F60\u662F\u4E00\u4E2A\u5386\u53F2\u5B66\u548C\u767E\u79D1\u77E5\u8BC6\u4E13\u5BB6\u3002\u5F53\u88AB\u8981\u6C42\u8FD4\u56DE JSON \u65F6\uFF0C\u8BF7\u4E25\u683C\u9075\u5B88\u6307\u5B9A\u7684 schema\uFF0C\u4E14\u53EA\u8FD4\u56DE JSON \u539F\u59CB\u5185\u5BB9...`;
    const res = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: prompt }
        ]
      })
    });
    if (!res.ok) throw new Error(`Aliyun API error`);
    const json = await res.json();
    let content = json.choices[0].message.content || "";
    content = content.replace(/<think>[\s\S]*?<\/think>/ig, "").trim();
    if (responseFormat === "json") {
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/i);
      if (jsonMatch) content = jsonMatch[1].trim();
      else {
        const start = content.indexOf("{");
        const end = content.lastIndexOf("}");
        if (start !== -1 && end !== -1) content = content.substring(start, end + 1);
      }
    }
    return content;
  } else {
    const apiKey = await getConfig(db2, "gemini_api_key") || c.env && c.env.GEMINI_API_KEY || typeof process !== "undefined" && process.env.GEMINI_API_KEY;
    const modelId = await getConfig(db2, "gemini_model_id") || c.env && c.env.GEMINI_MODEL_ID || typeof process !== "undefined" && process.env.GEMINI_MODEL_ID || "gemini-1.5-flash";
    if (!apiKey) throw new Error("\u7F3A\u5C11 Gemini API Key");
    if (!modelId) throw new Error("\u7F3A\u5C11 Gemini \u6A21\u578B ID");
    const ai = new import_genai.GoogleGenAI({ apiKey });
    const result = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: responseFormat === "json" ? {
        responseMimeType: "application/json",
        responseSchema: schema
      } : void 0
    });
    let content = result.text || "";
    content = content.replace(/<think>[\s\S]*?<\/think>/ig, "").trim();
    if (responseFormat === "json") {
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/i);
      if (jsonMatch) content = jsonMatch[1].trim();
      else {
        const start = content.indexOf("{");
        const end = content.lastIndexOf("}");
        if (start !== -1 && end !== -1) content = content.substring(start, end + 1);
      }
    }
    return content;
  }
}
async function getPortraitUrl(c, name) {
  const headers = { "User-Agent": "HistoricalArchiveApp/1.0" };
  try {
    let finalUrl = "";
    const searchWikidata = async (lang) => {
      const res = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=${lang}&format=json`, { headers });
      const data = await res.json();
      return data.search?.[0];
    };
    let entity = await searchWikidata("zh");
    if (!entity) entity = await searchWikidata("en");
    if (entity) {
      const entityRes = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entity.id}&props=claims&format=json`, { headers });
      const entityData = await entityRes.json();
      const claims = entityData.entities[entity.id].claims;
      if (claims.P18 && claims.P18.length > 0) {
        const imageName = claims.P18[0].mainsnak.datavalue.value;
        finalUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(imageName.replace(/ /g, "_"))}?width=500`;
      }
    }
    if (!finalUrl) {
      const getWikiImage = async (lang) => {
        const wikiRes = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(name)}&prop=pageimages&format=json&pithumbsize=500`, { headers });
        const wikiData = await wikiRes.json();
        const pages = wikiData.query?.pages;
        if (pages) {
          const pageId = Object.keys(pages)[0];
          if (pageId !== "-1" && pages[pageId].thumbnail) return pages[pageId].thumbnail.source;
        }
        return null;
      };
      finalUrl = await getWikiImage("zh") || await getWikiImage("en") || "";
    }
    if (!finalUrl) {
      finalUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent("Historical portrait of " + name + ", realistic oil painting style, highly detailed, historical accuracy")}`;
    }
    const imagesBucket = c.env?.IMAGES;
    if (imagesBucket && finalUrl) {
      try {
        const imageRes = await fetch(finalUrl);
        const contentType = imageRes.headers.get("content-type") || "image/jpeg";
        const buffer = await imageRes.arrayBuffer();
        const key = `portraits/${encodeURIComponent(name.toLowerCase())}.jpg`;
        await imagesBucket.put(key, buffer, { httpMetadata: { contentType } });
      } catch (e) {
        console.error("R2 Error:", e);
      }
    }
    return finalUrl;
  } catch (e) {
    return null;
  }
}
async function addRelationship(db2, p1, p2, type) {
  const min = Math.min(p1, p2);
  const max = Math.max(p1, p2);
  try {
    await db2.prepare("INSERT INTO relationships (person1_id, person2_id, relationship_type) VALUES (?, ?, ?)").run(min, max, type);
  } catch (e) {
  }
}
app.get("/health", (c) => c.json({ status: "ok" }));
app.post("/admin/verify", async (c) => {
  const { password } = await c.req.json();
  if (password === getAdminPassword(c)) return c.json({ success: true });
  return c.json({ error: "\u5BC6\u7801\u9519\u8BEF" }, 401);
});
app.get("/admin/config", async (c) => {
  if (c.req.header("x-admin-password") !== getAdminPassword(c)) return c.json({ error: "Unauthorized" }, 401);
  const db2 = await getDb(c);
  return c.json({
    active_model_provider: await getConfig(db2, "active_model_provider", "gemini"),
    gemini_api_key: await getConfig(db2, "gemini_api_key"),
    gemini_model_id: await getConfig(db2, "gemini_model_id"),
    aliyun_api_key: await getConfig(db2, "aliyun_api_key"),
    aliyun_model_id: await getConfig(db2, "aliyun_model_id"),
    guest_explore_limit: await getConfig(db2, "guest_explore_limit", "5")
  });
});
app.post("/admin/config", async (c) => {
  if (c.req.header("x-admin-password") !== getAdminPassword(c)) return c.json({ error: "Unauthorized" }, 401);
  const db2 = await getDb(c);
  const body = await c.req.json();
  if (body.active_model_provider) await setConfig(db2, "active_model_provider", body.active_model_provider);
  if (body.gemini_api_key !== void 0) await setConfig(db2, "gemini_api_key", body.gemini_api_key);
  if (body.gemini_model_id !== void 0) await setConfig(db2, "gemini_model_id", body.gemini_model_id);
  if (body.aliyun_api_key !== void 0) await setConfig(db2, "aliyun_api_key", body.aliyun_api_key);
  if (body.aliyun_model_id !== void 0) await setConfig(db2, "aliyun_model_id", body.aliyun_model_id);
  if (body.guest_explore_limit !== void 0) await setConfig(db2, "guest_explore_limit", String(body.guest_explore_limit));
  return c.json({ success: true });
});
app.get("/admin/people", async (c) => {
  if (c.req.header("x-admin-password") !== getAdminPassword(c)) return c.json({ error: "Unauthorized" }, 401);
  const db2 = await getDb(c);
  const people = await db2.prepare("SELECT id, name, category, created_at FROM people ORDER BY created_at DESC").all();
  return c.json(people);
});
app.delete("/admin/people/:id", async (c) => {
  if (c.req.header("x-admin-password") !== getAdminPassword(c)) return c.json({ error: "Unauthorized" }, 401);
  const db2 = await getDb(c);
  const id = c.req.param("id");
  await db2.prepare("DELETE FROM relationships WHERE person1_id = ? OR person2_id = ?").run(id, id);
  await db2.prepare("DELETE FROM people WHERE id = ?").run(id);
  return c.json({ success: true });
});
app.post("/admin/people/batch-delete", async (c) => {
  if (c.req.header("x-admin-password") !== getAdminPassword(c)) return c.json({ error: "Unauthorized" }, 401);
  const db2 = await getDb(c);
  const { ids } = await c.req.json();
  if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: "No ids provided" }, 400);
  const placeholders = ids.map(() => "?").join(",");
  await db2.prepare(`DELETE FROM relationships WHERE person1_id IN (${placeholders}) OR person2_id IN (${placeholders})`).run(...ids, ...ids);
  await db2.prepare(`DELETE FROM people WHERE id IN (${placeholders})`).run(...ids);
  return c.json({ success: true });
});
app.get("/archive", async (c) => {
  const db2 = await getDb(c);
  const people = await db2.prepare("SELECT * FROM people ORDER BY created_at DESC").all();
  const relationships = await db2.prepare("SELECT * FROM relationships").all();
  return c.json({ people, relationships });
});
app.get("/metadata", async (c) => {
  const db2 = await getDb(c);
  const existingPeopleNames = (await db2.prepare("SELECT name FROM people").all()).map((p) => p.name).join("\u3001");
  return c.json({
    categories: CATEGORIES,
    existingNames: existingPeopleNames,
    activeProvider: await getConfig(db2, "active_model_provider", "gemini"),
    geminiModelId: await getConfig(db2, "gemini_model_id"),
    geminiApiKey: !!(await getConfig(db2, "gemini_api_key") || c.env && c.env.GEMINI_API_KEY || typeof process !== "undefined" && process.env.GEMINI_API_KEY),
    aliyunModelId: await getConfig(db2, "aliyun_model_id"),
    aliyunApiKey: !!await getConfig(db2, "aliyun_api_key"),
    remainingQuota: await getRemainingQuota(db2)
  });
});
app.get("/usage/remaining", async (c) => {
  const db2 = await getDb(c);
  return c.json({ remaining: await getRemainingQuota(db2) });
});
app.post("/usage/record", async (c) => {
  const db2 = await getDb(c);
  await incrementUsage(db2);
  return c.json({ success: true, remaining: await getRemainingQuota(db2) });
});
app.post("/people/:id/view", async (c) => {
  const db2 = await getDb(c);
  const id = c.req.param("id");
  await db2.prepare("UPDATE people SET views = views + 1 WHERE id = ?").run(id);
  return c.json({ success: true });
});
app.post("/save-archive", async (c) => {
  const db2 = await getDb(c);
  const { name, data } = await c.req.json();
  if (!name) return c.json({ error: "Missing name" }, 400);
  const existing = await db2.prepare("SELECT id, biography FROM people WHERE name = ?").get(name);
  const isFull = existing && existing.biography !== "\u6B63\u5728\u540C\u6B65\u8D44\u6599...";
  if (!data) {
    if (existing) return c.json({ id: existing.id, isNew: false, isFull });
    return c.json({ id: null, isNew: true, isFull: false });
  }
  try {
    const portraitUrl = await getPortraitUrl(c, name);
    const stmt = db2.prepare(`
      INSERT INTO people (name, category, keyword, lifespan, birthplace, biography, achievements, image_url, raw_relationships, latitude, longitude)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET 
        category=excluded.category, keyword=excluded.keyword, lifespan=excluded.lifespan, birthplace=excluded.birthplace, biography=excluded.biography, 
        achievements=excluded.achievements, image_url=excluded.image_url, raw_relationships=excluded.raw_relationships, latitude=excluded.latitude, longitude=excluded.longitude
      RETURNING id
    `);
    const inserted = await stmt.get(
      name,
      data.category || "\u5176\u4ED6",
      data.keyword || "",
      data.lifespan || "",
      data.birthplace || "",
      data.biography || "",
      JSON.stringify(data.achievements || []),
      portraitUrl,
      JSON.stringify(data.relationships || []),
      data.latitude || 0,
      data.longitude || 0
    );
    if (data.relationships && Array.isArray(data.relationships)) {
      for (const rel of data.relationships) {
        const matched = await db2.prepare("SELECT id FROM people WHERE name = ?").get(rel.personName);
        if (matched) await addRelationship(db2, inserted.id, matched.id, rel.relationshipType);
      }
    }
    return c.json({ id: inserted.id, isNew: true, isFull: true });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});
app.post("/pathfind", async (c) => {
  const db2 = await getDb(c);
  let { sourceName, targetName } = await c.req.json();
  if (!sourceName || !targetName) return c.json({ error: "Missing names" }, 400);
  const people = await db2.prepare("SELECT id, name, raw_relationships FROM people").all();
  const relationships = await db2.prepare("SELECT * FROM relationships").all();
  const nameToId = new Map(people.map((p) => [p.name, p.id]));
  const idToName = new Map(people.map((p) => [p.id, p.name]));
  const adj = /* @__PURE__ */ new Map();
  relationships.forEach((r) => {
    if (!adj.has(r.person1_id)) adj.set(r.person1_id, []);
    if (!adj.has(r.person2_id)) adj.set(r.person2_id, []);
    adj.get(r.person1_id).push({ id: r.person2_id, type: r.relationship_type });
    adj.get(r.person2_id).push({ id: r.person1_id, type: r.relationship_type });
  });
  people.forEach((p) => {
    try {
      const raw = JSON.parse(p.raw_relationships || "[]");
      raw.forEach((r) => {
        if (!r.personName) return;
        const targetId = nameToId.get(r.personName);
        if (targetId !== void 0 && targetId !== p.id) {
          if (!adj.has(p.id)) adj.set(p.id, []);
          if (!adj.get(p.id).some((n) => n.id === targetId)) adj.get(p.id).push({ id: targetId, type: r.relationshipType || "\u5386\u53F2\u5173\u8054" });
          if (!adj.has(targetId)) adj.set(targetId, []);
          if (!adj.get(targetId).some((n) => n.id === p.id)) adj.get(targetId).push({ id: p.id, type: r.relationshipType || "\u5386\u53F2\u5173\u8054" });
        }
      });
    } catch (e) {
    }
  });
  const startId = nameToId.get(sourceName);
  const endId = nameToId.get(targetName);
  if (startId !== void 0 && endId !== void 0) {
    const queue = [{ id: startId, path: [{ name: sourceName }] }];
    const visited = /* @__PURE__ */ new Set([startId]);
    while (queue.length > 0) {
      const { id, path: path2 } = queue.shift();
      if (id === endId) return c.json({ path: path2 });
      const neighbors = adj.get(id) || [];
      for (const n of neighbors) {
        if (!visited.has(n.id)) {
          visited.add(n.id);
          queue.push({ id: n.id, path: [...path2, { name: idToName.get(n.id), type: n.type }] });
        }
      }
    }
  }
  return c.json({ path: null });
});
app.get("/archiver/random-pair", async (c) => {
  const db2 = await getDb(c);
  const count = await db2.prepare("SELECT COUNT(*) as count FROM people").get();
  if (count.count < 2) return c.json({ error: "Need at least 2 people in database" }, 400);
  const people = await db2.prepare("SELECT name FROM people ORDER BY RANDOM() LIMIT 2").all();
  return c.json({ sourceName: people[0].name, targetName: people[1].name });
});
app.post("/archiver/pick-target", async (c) => {
  const db2 = await getDb(c);
  const existing = (await db2.prepare("SELECT name FROM people").all()).map((p) => p.name);
  if (existing.length === 0) return c.json({ error: "No people in database to start from" });
  const existingSet = new Set(existing);
  const sourceName = existing[Math.floor(Math.random() * existing.length)];
  let targetName = "";
  const unarchivedInPool = [];
  for (const cat of CATEGORIES) {
    FIGURE_POOL[cat]?.forEach((n) => {
      if (!existingSet.has(n)) unarchivedInPool.push(n);
    });
  }
  if (unarchivedInPool.length > 0) {
    targetName = unarchivedInPool[Math.floor(Math.random() * unarchivedInPool.length)];
  } else {
    const wanted = /* @__PURE__ */ new Set();
    const peopleRels = await db2.prepare("SELECT raw_relationships FROM people").all();
    peopleRels.forEach((p) => {
      try {
        JSON.parse(p.raw_relationships || "[]").forEach((r) => {
          if (r.personName && !existingSet.has(r.personName)) wanted.add(r.personName);
        });
      } catch (e) {
      }
    });
    if (wanted.size > 0) {
      const wantedArray = Array.from(wanted);
      targetName = wantedArray[Math.floor(Math.random() * wantedArray.length)];
    }
  }
  return c.json({ sourceName, targetName });
});
app.post("/archiver/generate-target", async (c) => {
  const db2 = await getDb(c);
  const { sourceName } = await c.req.json();
  const existingNames = (await db2.prepare("SELECT name FROM people").all()).map((p) => p.name).join("\u3001");
  try {
    const prompt = `\u8BF7\u4ECE\u4E16\u754C\u5386\u53F2\u4E2D\u9009\u53D6\u4E00\u4F4D\u6781\u5176\u8457\u540D\u3001\u5177\u6709\u91CD\u5927\u5168\u7403\u5F71\u54CD\u529B\u4E14\u901A\u5E38\u88AB\u89C6\u4E3A\u6B63\u9762\u7684\u771F\u5B9E\u5386\u53F2\u4EBA\u7269\u3002\u8981\u6C42\u4E0D\u5305\u542B\u5728\u5217\u8868\u4E2D\uFF1A[${existingNames.slice(0, 500)}]\uFF0C\u5173\u8054\uFF1A${sourceName || ""}`;
    const resultText = await callAI(c, db2, prompt, "text");
    const targetName = (resultText || "").trim().replace(/[「」""'']/g, "");
    return c.json({ targetName });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});
app.post("/archive-figure", async (c) => {
  const db2 = await getDb(c);
  const { personName, stream } = await c.req.json();
  let targetName = personName;
  const existingNames = (await db2.prepare("SELECT name FROM people").all()).map((p) => p.name).join("\u3001");
  if (!targetName) {
    const existing = (await db2.prepare("SELECT name FROM people").all()).map((p) => p.name);
    return c.json({ error: "Missing target" }, 400);
  }
  if (stream) {
    const pass = c.req.header("x-admin-password");
    const isAdmin = pass === getAdminPassword(c);
    if (!isAdmin && await getRemainingQuota(db2) <= 0) {
      return c.json({ error: "\u4ECA\u65E5\u63A2\u7D22\u6B21\u6570\u5DF2\u8FBE\u4E0A\u9650" }, 403);
    }
    return (0, import_streaming.streamSSE)(c, async (stream2) => {
      const send = async (data) => await stream2.writeSSE({ data: JSON.stringify(data) });
      try {
        await send({ type: "info", msg: `\u786E\u5B9A\u6293\u53D6\u76EE\u6807: ${targetName}` });
        await send({ type: "info", msg: `\u6B63\u5728\u5229\u7528 AI \u6DF1\u5EA6\u68C0\u7D22\u5E76\u7F16\u7EC7 ${targetName} \u7684\u5386\u53F2\u65F6\u7A7A\u6570\u636E...` });
        const prompt = `\u4F60\u662F\u4E00\u4F4D\u7814\u7A76\u5386\u53F2\u4EBA\u7269\u7684\u4F20\u8BB0\u4E13\u5BB6\u3002\u8BF7\u4E3A "${targetName}" \u64B0\u5199\u4F20\u8BB0\u3002
              \u8981\u6C42\u8FD4\u56DE JSON:
              {
                "keyword": "\u683C\u8A00",
                "lifespan": "\u51FA\u751F\u65E5\u671F-\u53BB\u4E16\u65E5\u671F",
                "birthplace": "\u51FA\u751F\u5730\u70B9",
                "biography": "\u5206\u6BB5\u5448\u73B0\uFF0C\u8BED\u8A00\u6B63\u89C4\u4E14\u8BD9\u8C10\u5E7D\u9ED8\uFF0C\u76F4\u63A5\u8FDB\u5165\u4E3B\u9898\u3002",
                "achievements": ["\u6210\u5C311", "\u6210\u5C312"],
                "category": "\u4ECE[${CATEGORIES.join(",")}]\u9009\u4E00",
                "latitude": \u7EAC\u5EA6,
                "longitude": \u7ECF\u5EA6,
                "relationships": [{"personName": "\u5173\u8054\u4EBA\u540D", "relationshipType": "\u8BF7\u752820-30\u5B57\u63CF\u8FF0\u5173\u8054"}]
              }
              \u91CD\u8981\uFF1A\u5FC5\u987B\u81F3\u5C11\u5305\u542B 1 \u4E2A\u4EE5\u4E0B\u5DF2\u5165\u5E93\u4EBA\u7269\uFF1A[${existingNames.slice(0, 500)}]\u3002`;
        let resultText = await callAI(c, db2, prompt, "json");
        let data = {};
        try {
          let rawData = JSON.parse(resultText || "{}");
          data = Array.isArray(rawData) && rawData.length > 0 ? rawData[0] : rawData;
        } catch (e) {
          data = { category: "\u5176\u4ED6", biography: "\u8D44\u6599\u89E3\u6790\u5931\u8D25", achievements: [], relationships: [] };
        }
        await send({ type: "info", msg: `\u6B63\u5728\u83B7\u53D6 ${targetName} \u7684\u5386\u53F2\u8096\u50CF...` });
        const portraitUrl = await getPortraitUrl(c, targetName);
        await send({ type: "info", msg: `\u6B63\u5728\u5C06 ${targetName} \u5F55\u5165\u65F6\u7A7A\u6863\u6848\u9986...` });
        const existing = await db2.prepare("SELECT id FROM people WHERE name = ?").get(targetName);
        let personId;
        if (existing) {
          personId = existing.id;
          await send({ type: "info", msg: `${targetName} \u5DF2\u5B58\u5728\uFF0C\u6B63\u5728\u66F4\u65B0\u8D44\u6599...` });
        } else {
          const stmt = db2.prepare(`
                      INSERT INTO people (name, category, keyword, lifespan, birthplace, biography, achievements, image_url, raw_relationships, latitude, longitude)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
                  `);
          const inserted = await stmt.get(
            targetName,
            data.category || "\u5176\u4ED6",
            data.keyword || "",
            data.lifespan || "",
            data.birthplace || "",
            data.biography || "",
            JSON.stringify(data.achievements || []),
            portraitUrl,
            JSON.stringify(data.relationships || []),
            data.latitude || 0,
            data.longitude || 0
          );
          personId = inserted.id;
        }
        if (data.relationships && Array.isArray(data.relationships)) {
          let connCount = 0;
          for (const rel of data.relationships) {
            const matched = await db2.prepare("SELECT id FROM people WHERE name = ?").get(rel.personName);
            if (matched) {
              await addRelationship(db2, personId, matched.id, rel.relationshipType);
              connCount++;
            }
          }
          if (connCount > 0) await send({ type: "info", msg: `\u6210\u529F\u5EFA\u7ACB ${connCount} \u6761\u65F6\u7A7A\u8FDE\u63A5\u3002` });
          else await send({ type: "info", msg: `\u672A\u53D1\u73B0\u5373\u65F6\u65F6\u7A7A\u8FDE\u63A5\uFF0C\u5DF2\u4FDD\u7559\u5173\u8054\u7D22\u5F15\u4F9B\u540E\u7EED\u8FFD\u6EAF\u3002` });
        }
        if (!isAdmin) {
          await incrementUsage(db2);
          await send({ type: "usage-update", remaining: await getRemainingQuota(db2) });
        }
        await send({ type: "result", personId });
      } catch (e) {
        await send({ type: "error", msg: e.message });
      }
    });
  } else {
    return c.json({ error: "Always use streaming for this endpoint in current UI" }, 400);
  }
});
app.post("/save-relationship", async (c) => {
  const db2 = await getDb(c);
  const { sourceName, targetName, relationshipType } = await c.req.json();
  if (!sourceName || !targetName || !relationshipType) return c.json({ error: "Missing info" }, 400);
  const p1 = await db2.prepare("SELECT id FROM people WHERE name = ?").get(sourceName);
  const p2 = await db2.prepare("SELECT id FROM people WHERE name = ?").get(targetName);
  if (p1 && p2) {
    await addRelationship(db2, p1.id, p2.id, relationshipType);
    return c.json({ success: true });
  } else {
    return c.json({ error: "People not found for relationship" }, 404);
  }
});
app.post("/ai/proxy", async (c) => {
  const db2 = await getDb(c);
  const { prompt, responseFormat, schema } = await c.req.json();
  try {
    const text = await callAI(c, db2, prompt, responseFormat, schema);
    return c.json({ text });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// server.ts
var import_better_sqlite3 = __toESM(require("better-sqlite3"), 1);
import_dotenv.default.config();
if (process.env.NODE_ENV !== "production") {
  const envExamplePath = import_path.default.join(process.cwd(), ".env.example");
  if (import_fs.default.existsSync(envExamplePath)) {
    const exampleConfig = import_dotenv.default.parse(import_fs.default.readFileSync(envExamplePath));
    for (const k in exampleConfig) {
      if (!process.env[k] || process.env[k] === "") {
        process.env[k] = exampleConfig[k];
      }
    }
  }
}
var NodeDatabaseAdapter = class {
  constructor(filename) {
    this.db = new import_better_sqlite3.default(filename);
  }
  prepare(sql) {
    const stmt = this.db.prepare(sql);
    return {
      all: async (...params) => stmt.all(...params),
      get: async (...params) => stmt.get(...params),
      run: async (...params) => {
        const result = stmt.run(...params);
        return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
      }
    };
  }
  async exec(sql) {
    this.db.exec(sql);
  }
  pragma(sql) {
    this.db.pragma(sql);
  }
};
var db = new NodeDatabaseAdapter("celebrity_graph.sqlite");
db.pragma("journal_mode = WAL");
async function startServer() {
  const app2 = (0, import_express.default)();
  const PORT = 3e3;
  app2.all("/api/*", (req, res) => {
    (0, import_node_server.getRequestListener)((request) => {
      return app.fetch(request, {
        ...process.env,
        DB_ADAPTER: db
      });
    })(req, res);
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app2.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app2.use(import_express.default.static(distPath));
    app2.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app2.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
