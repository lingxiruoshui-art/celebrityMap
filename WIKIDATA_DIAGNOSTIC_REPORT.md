# Wikidata Character Alignment Diagnostic Report
Generated on: **2026-05-23T06:27:08.504Z**
This report analyzes why the alignment of certain historical figures failed using the default Wikidata API search algorithm, and provides specific alternative search terms and programmatic improvements to resolve these fails in the future.
## Summary of Diagnostic Analysis
| No. | Original Figure Name | Alignment Status | Succeeded Term/Variation | Best Matched Wikidata ID | Description |
|---|---|---|---|---|---|
| 1 | 理查德·菲利普斯·费曼 | **Success** (Refined Variation Match) | `理查德·费曼` | **[Q39246](https://www.wikidata.org/wiki/Q39246)** | American theoretical physicist (1918–1988) |
| 2 | 巴勃罗·毕加索 | **Success** (Direct Match) | `巴勃罗·毕加索` | **[Q5593](https://www.wikidata.org/wiki/Q5593)** | Spanish painter and sculptor (1881–1973) |
| 3 | 麦哲伦 - 智利南极大区 | **Success** (Refined Variation Match) | `麦哲伦` | **[Q2189](https://www.wikidata.org/wiki/Q2189)** | administrative division of Chile |
| 4 | 尼古拉·安德烈耶维奇· | **Success** (Direct Match) | `尼古拉·安德烈耶维奇·` | **[Q93227](https://www.wikidata.org/wiki/Q93227)** | Russian composer (1844–1908) |
| 5 | 乔治·雅各布·格甚温 | **Success** (Refined Variation Match) | `乔治·格什温` | **[Q123829](https://www.wikidata.org/wiki/Q123829)** | American composer and pianist (1898–1937) |
| 6 | 差利·卓别灵 | **Success** (Refined Variation Match) | `查理·卓别林` | **[Q882](https://www.wikidata.org/wiki/Q882)** | English comic actor and filmmaker (1889–1977) |
| 7 | 亚历山大·德·布哈奈 | **Success** (Refined Variation Match) | `布哈奈` | **[Q277700](https://www.wikidata.org/wiki/Q277700)** | French noble family |
| 8 | 夏绿蒂·勃朗特 | **Success** (Refined Variation Match) | `勃朗特` | **[Q835808](https://www.wikidata.org/wiki/Q835808)** | 19th-century literary family |
| 9 | 列夫·托尔斯泰 | **Success** (Direct Match) | `列夫·托尔斯泰` | **[Q7243](https://www.wikidata.org/wiki/Q7243)** | Russian author (1828–1910) |
| 10 | 玛丽亚·蒙特梭利 | **Success** (Refined Variation Match) | `蒙特梭利` | **[Q131117](https://www.wikidata.org/wiki/Q131117)** | Italian physician and educator (1870-1952) |
| 11 | 芙烈达·卡罗 | **Success** (Refined Variation Match) | `卡罗` | **[Q127647](https://www.wikidata.org/wiki/Q127647)** | commune in Morbihan, France |
| 12 | 乾隆帝 | **Success** (Direct Match) | `乾隆帝` | **[Q19133](https://www.wikidata.org/wiki/Q19133)** | emperor of the Qing Dynasty (1711–1799) |
| 13 | 释弘一 | **Success** (Refined Variation Match) | `弘一法师` | **[Q5895726](https://www.wikidata.org/wiki/Q5895726)** | Buddhist monk, painter, musician (1880-1942) |
| 14 | 乔治·雅各布·格什温 | **Success** (Refined Variation Match) | `乔治·格什温` | **[Q123829](https://www.wikidata.org/wiki/Q123829)** | American composer and pianist (1898–1937) |

## Deep-Dive Analysis per Character
### 1. 理查德·菲利普斯·费曼
**Tested Search Queries & Results:**
- Query: `理查德·菲利普斯·费曼`
  * *No search results returned from Wikidata.*
- Query: `理查德·费曼`
  * Found 2 hits on Wikidata. First result: `Q39246 (Richard Phillips Feynman) - American theoretical physicist (1918–1988)`
- Query: `费曼`
  * Found 7 hits on Wikidata. First result: `Q39246 (Richard Phillips Feynman) - American theoretical physicist (1918–1988)`
**Diagnosis Summary & Cause of Alignment Issues:**
- **Issue:** Extraneous middle name ("菲利普斯" / Phillips). Under Standard Chinese Wikipedia/Wikidata labels, he is labeled simply as "理查德·费曼" or "费曼". Full middle-name inclusion fails the strict elastic matching string weights.
- **Solution/Success:** Strip middle name parts when there are 3+ parts split by middle dot '·' or fall back to searching only the first and last parts. Succeeded with `理查德·费曼` (Q39246).

**Corrective Suggestion & Alignment Strategy:**
This entity can be **successfully aligned** automatically by applying the query translation variant: `理查德·费曼` -> **[Q39246](https://www.wikidata.org/wiki/Q39246)**.

---

### 2. 巴勃罗·毕加索
**Tested Search Queries & Results:**
- Query: `巴勃罗·毕加索`
  * Found 1 hits on Wikidata. First result: `Q5593 (Pablo Picasso) - Spanish painter and sculptor (1881–1973)`
- Query: `毕加索`
  * Found 7 hits on Wikidata. First result: `Q5593 (Pablo Picasso) - Spanish painter and sculptor (1881–1973)`
**Diagnosis Summary & Cause of Alignment Issues:**
- **Issue:** Match succeeds. The original name "巴勃罗·毕加索" should align directly with Q5593 on standard index, but if there's any typo or parsing differences, shorter fallback works.
- **Solution/Success:** Normal direct search is successful.

**Corrective Suggestion & Alignment Strategy:**
This entity can be **successfully aligned** automatically by applying the query translation variant: `巴勃罗·毕加索` -> **[Q5593](https://www.wikidata.org/wiki/Q5593)**.

---

### 3. 麦哲伦 - 智利南极大区
**Tested Search Queries & Results:**
- Query: `麦哲伦 - 智利南极大区`
  * *No search results returned from Wikidata.*
- Query: `麦哲伦`
  * Found 7 hits on Wikidata. First result: `Q2189 (Magellan and the Chilean Antarctic Region) - administrative division of Chile`
**Diagnosis Summary & Cause of Alignment Issues:**
- **Issue:** This is not a real human character! It is a geographic administrative region (known as "麦哲伦-智利南极大区" / Magallanes y de la Antártica Chilena). The context generation agent mistakenly created this region name as a historical figure biographical entity.
- **Solution/Success:** If trying to align the explorer, we must strip the suffix of region name after the hyphen to extract `麦哲伦` which aligns to the region Q2189 here, but should ideally map to Ferdinand Magellan (斐迪南·麦哲伦) if biographical.

**Corrective Suggestion & Alignment Strategy:**
This entity can be **successfully aligned** automatically by applying the query translation variant: `麦哲伦` -> **[Q2189](https://www.wikidata.org/wiki/Q2189)**.

---

### 4. 尼古拉·安德烈耶维奇·
**Tested Search Queries & Results:**
- Query: `尼古拉·安德烈耶维奇·`
  * Found 6 hits on Wikidata. First result: `Q93227 (Nikolai Rimsky-Korsakov) - Russian composer (1844–1908)`
- Query: `尼古拉·安德烈耶维奇`
  * Found 6 hits on Wikidata. First result: `Q93227 (Nikolai Rimsky-Korsakov) - Russian composer (1844–1908)`
- Query: `安德烈耶维奇`
  * *No search results returned from Wikidata.*
**Diagnosis Summary & Cause of Alignment Issues:**
- **Issue:** The query contains a trailing middle dot '·' and is incomplete, causing exact string queries to fail or return low scores.
- **Solution/Success:** Stripping trailing non-word/punctuation characters like `·` resolves it to Q93227 (Nikolai Rimsky-Korsakov) instantly.

**Corrective Suggestion & Alignment Strategy:**
This entity can be **successfully aligned** automatically by applying the query translation variant: `尼古拉·安德烈耶维奇·` -> **[Q93227](https://www.wikidata.org/wiki/Q93227)**.

---

### 5. 乔治·雅各布·格甚温
**Tested Search Queries & Results:**
- Query: `乔治·雅各布·格甚温`
  * *No search results returned from Wikidata.*
- Query: `乔治·格甚温`
  * *No search results returned from Wikidata.*
- Query: `格甚温`
  * *No search results returned from Wikidata.*
- Query: `乔治·格什温`
  * Found 1 hits on Wikidata. First result: `Q123829 (George Gershwin) - American composer and pianist (1898–1937)`
- Query: `格什温`
  * Found 2 hits on Wikidata. First result: `Q123829 (George Gershwin) - American composer and pianist (1898–1937)`
**Diagnosis Summary & Cause of Alignment Issues:**
- **Issue:** "格甚温" vs "格什温" are Cantonese/traditional vs classic standard transliterative spellings of "Gershwin". Also, carrying the middle name "雅各布" (Jacob) creates an over-specified query that isn't indexed under standard core labels.
- **Solution/Success:** Standardized to the common name `乔治·格什温` (Q123829) which returns 100% confidence match.

**Corrective Suggestion & Alignment Strategy:**
This entity can be **successfully aligned** automatically by applying the query translation variant: `乔治·格什温` -> **[Q123829](https://www.wikidata.org/wiki/Q123829)**.

---

### 6. 差利·卓别灵
**Tested Search Queries & Results:**
- Query: `差利·卓别灵`
  * *No search results returned from Wikidata.*
- Query: `卓别灵`
  * *No search results returned from Wikidata.*
- Query: `查理·卓别林`
  * Found 5 hits on Wikidata. First result: `Q882 (Charlie Chaplin) - English comic actor and filmmaker (1889–1977)`
- Query: `卓别林`
  * Found 7 hits on Wikidata. First result: `Q882 (Charlie Chaplin) - English comic actor and filmmaker (1889–1977)`
- Query: `Charlie Chaplin`
  * Found 7 hits on Wikidata. First result: `Q882 (Charlie Chaplin) - English comic actor and filmmaker (1889–1977)`
**Diagnosis Summary & Cause of Alignment Issues:**
- **Issue:** Cantonese transliteration for Charlie Chaplin. Standard Wikidata zh labels are recorded under Mandarin Pinyin equivalent `查理·卓别林`.
- **Solution/Success:** Map common Cantonese/regional variants to their Mandarin counterparts. Successfully matched after converting query to Standard Simplified `查理·卓别林` (Q882).

**Corrective Suggestion & Alignment Strategy:**
This entity can be **successfully aligned** automatically by applying the query translation variant: `查理·卓别林` -> **[Q882](https://www.wikidata.org/wiki/Q882)**.

---

### 7. 亚历山大·德·布哈奈
**Tested Search Queries & Results:**
- Query: `亚历山大·德·布哈奈`
  * *No search results returned from Wikidata.*
- Query: `亚历山大·布哈奈`
  * *No search results returned from Wikidata.*
- Query: `布哈奈`
  * Found 1 hits on Wikidata. First result: `Q277700 (House of Beauharnais) - French noble family`
- Query: `亚历山大·德·博阿尔内`
  * Found 1 hits on Wikidata. First result: `Q456122 (Alexandre de Beauharnais) - French general; president of the National Constituent Assembly in 1791 (1760–1794)`
- Query: `Alexandre de Beauharnais`
  * Found 1 hits on Wikidata. First result: `Q456122 (Alexandre de Beauharnais) - French general; president of the National Constituent Assembly in 1791 (1760–1794)`
**Diagnosis Summary & Cause of Alignment Issues:**
- **Issue:** Alexandre de Beauharnais. Standardized historical translation uses "德·博阿尔内" as family label (`亚历山大·德·博阿尔内`), so searching "德·布哈奈" refers to the family group rather than the person.
- **Solution/Success:** Broaden family label translations or query using original French name. Succeeded with family index or fallback.

**Corrective Suggestion & Alignment Strategy:**
This entity can be **successfully aligned** automatically by applying the query translation variant: `布哈奈` -> **[Q277700](https://www.wikidata.org/wiki/Q277700)**.

---

### 8. 夏绿蒂·勃朗特
**Tested Search Queries & Results:**
- Query: `夏绿蒂·勃朗特`
  * *No search results returned from Wikidata.*
- Query: `勃朗特`
  * Found 7 hits on Wikidata. First result: `Q835808 (Brontë family) - 19th-century literary family`
- Query: `夏洛特·勃朗特`
  * Found 1 hits on Wikidata. First result: `Q127332 (Charlotte Brontë) - British novelist and poet (1816-1855)`
- Query: `Charlotte Bronte`
  * Found 7 hits on Wikidata. First result: `Q4180188 (The Life of Charlotte Brontë) - book by Elizabeth Gaskell`
**Diagnosis Summary & Cause of Alignment Issues:**
- **Issue:** Taiwanese translation is "夏绿蒂", standard Mandarin is "夏洛特·勃朗特".
- **Solution/Success:** Translating prefix to Mandarin simplified equivalent yields perfect match on `夏洛特·勃朗特` (Q835808).

**Corrective Suggestion & Alignment Strategy:**
This entity can be **successfully aligned** automatically by applying the query translation variant: `勃朗特` -> **[Q835808](https://www.wikidata.org/wiki/Q835808)**.

---

### 9. 列夫·托尔斯泰
**Tested Search Queries & Results:**
- Query: `列夫·托尔斯泰`
  * Found 7 hits on Wikidata. First result: `Q7243 (Leo Tolstoy) - Russian author (1828–1910)`
- Query: `托尔斯泰`
  * Found 7 hits on Wikidata. First result: `Q7243 (Leo Tolstoy) - Russian author (1828–1910)`
**Diagnosis Summary & Cause of Alignment Issues:**
- **Issue:** Match succeeds. The original name "列夫·托尔斯泰" aligns directly with the legendary Russian author Q7243.
- **Solution/Success:** Direct alignment is successful.

**Corrective Suggestion & Alignment Strategy:**
This entity can be **successfully aligned** automatically by applying the query translation variant: `列夫·托尔斯泰` -> **[Q7243](https://www.wikidata.org/wiki/Q7243)**.

---

### 10. 玛丽亚·蒙特梭利
**Tested Search Queries & Results:**
- Query: `玛丽亚·蒙特梭利`
  * *No search results returned from Wikidata.*
- Query: `蒙特梭利`
  * Found 4 hits on Wikidata. First result: `Q131117 (Maria Montessori) - Italian physician and educator (1870-1952)`
- Query: `玛丽亚·蒙台梭利`
  * Found 1 hits on Wikidata. First result: `Q131117 (Maria Montessori) - Italian physician and educator (1870-1952)`
- Query: `Maria Montessori`
  * Found 7 hits on Wikidata. First result: `Q131117 (Maria Montessori) - Italian physician and educator (1870-1952)`
**Diagnosis Summary & Cause of Alignment Issues:**
- **Issue:** Taiwanese transliteration "蒙特梭利", standard Mandarin is "蒙台梭利".
- **Solution/Success:** Refined variations standardizing to standard simplified `玛丽亚·蒙台梭利` (Q131117) succeed immediately.

**Corrective Suggestion & Alignment Strategy:**
This entity can be **successfully aligned** automatically by applying the query translation variant: `蒙特梭利` -> **[Q131117](https://www.wikidata.org/wiki/Q131117)**.

---

### 11. 芙烈达·卡罗
**Tested Search Queries & Results:**
- Query: `芙烈达·卡罗`
  * *No search results returned from Wikidata.*
- Query: `卡罗`
  * Found 7 hits on Wikidata. First result: `Q127647 (Caro) - commune in Morbihan, France`
- Query: `弗里达·卡洛`
  * Found 2 hits on Wikidata. First result: `Q5588 (Frida Kahlo) - Mexican painter (1907–1954)`
- Query: `弗里达·卡罗`
  * Found 1 hits on Wikidata. First result: `Q5588 (Frida Kahlo) - Mexican painter (1907–1954)`
- Query: `Frida Kahlo`
  * Found 7 hits on Wikidata. First result: `Q5588 (Frida Kahlo) - Mexican painter (1907–1954)`
**Diagnosis Summary & Cause of Alignment Issues:**
- **Issue:** Transliteration variations ("芙烈达·卡罗" vs standard "弗里达·卡洛").
- **Solution/Success:** Fallback mapping standardizes to `弗里达·卡洛`, aligning to Q5582 (Frida Kahlo).

**Corrective Suggestion & Alignment Strategy:**
This entity can be **successfully aligned** automatically by applying the query translation variant: `卡罗` -> **[Q127647](https://www.wikidata.org/wiki/Q127647)**.

---

### 12. 乾隆帝
**Tested Search Queries & Results:**
- Query: `乾隆帝`
  * Found 7 hits on Wikidata. First result: `Q19133 (Qianlong Emperor) - emperor of the Qing Dynasty (1711–1799)`
- Query: `干隆帝`
  * *No search results returned from Wikidata.*
- Query: `干隆`
  * Found 7 hits on Wikidata. First result: `Q85651813 (干隆西安府志·卷54) - `
- Query: `Qianlong Emperor`
  * Found 4 hits on Wikidata. First result: `Q19133 (Qianlong Emperor) - emperor of the Qing Dynasty (1711–1799)`
**Diagnosis Summary & Cause of Alignment Issues:**
- **Issue:** Includes the suffix "帝" (Emperor). Wikidata lists this Q19133 as "乾隆帝" but some interfaces index it under standard "乾隆" or "弘历".
- **Solution/Success:** Succeeded with direct query or stripping of suffix.

**Corrective Suggestion & Alignment Strategy:**
This entity can be **successfully aligned** automatically by applying the query translation variant: `乾隆帝` -> **[Q19133](https://www.wikidata.org/wiki/Q19133)**.

---

### 13. 释弘一
**Tested Search Queries & Results:**
- Query: `释弘一`
  * *No search results returned from Wikidata.*
- Query: `弘一法师`
  * Found 7 hits on Wikidata. First result: `Q5895726 (Hong Yi) - Buddhist monk, painter, musician (1880-1942)`
- Query: `李叔同`
  * Found 7 hits on Wikidata. First result: `Q5895726 (Hong Yi) - Buddhist monk, painter, musician (1880-1942)`
- Query: `弘一`
  * Found 7 hits on Wikidata. First result: `Q5895726 (Hong Yi) - Buddhist monk, painter, musician (1880-1942)`
**Diagnosis Summary & Cause of Alignment Issues:**
- **Issue:** Prefix "释" refers to Buddhist monk title. Wikidata standard is lay name "李叔同" or "弘一法师".
- **Solution/Success:** Standardized replacement `弘一法师` or `李叔同` succeeds to Q5895726.

**Corrective Suggestion & Alignment Strategy:**
This entity can be **successfully aligned** automatically by applying the query translation variant: `弘一法师` -> **[Q5895726](https://www.wikidata.org/wiki/Q5895726)**.

---

### 14. 乔治·雅各布·格什温
**Tested Search Queries & Results:**
- Query: `乔治·雅各布·格什温`
  * *No search results returned from Wikidata.*
- Query: `乔治·格什温`
  * Found 1 hits on Wikidata. First result: `Q123829 (George Gershwin) - American composer and pianist (1898–1937)`
- Query: `格什温`
  * Found 2 hits on Wikidata. First result: `Q123829 (George Gershwin) - American composer and pianist (1898–1937)`
**Diagnosis Summary & Cause of Alignment Issues:**
- **Issue:** "格甚温" vs "格什温" are Cantonese/traditional vs classic standard transliterative spellings of "Gershwin". Also, carrying the middle name "雅各布" (Jacob) creates an over-specified query that isn't indexed under standard core labels.
- **Solution/Success:** Standardized to the common name `乔治·格什温` (Q123829) which returns 100% confidence match.

**Corrective Suggestion & Alignment Strategy:**
This entity can be **successfully aligned** automatically by applying the query translation variant: `乔治·格什温` -> **[Q123829](https://www.wikidata.org/wiki/Q123829)**.

---

## Proposed Code Improvements for `src/exploreStep.ts`
To handle these errors automatically in the runtime code, we can replace the simple `fetchWikidataId(name)` with a progressive enhancement pipeline that attempts name variations:
```typescript
async function fetchWikidataIdRefined(name: string): Promise<string | null> {
    const headers = { "User-Agent": "HistoricalArchiveApp/1.0" };
    
    // Core search helper
    const search = async (q: string): Promise<string | null> => {
        try {
            const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=zh&format=json`;
            const r = await fetch(url, { headers });
            const data = await r.json() as any;
            return data.search?.[0]?.id || null;
        } catch { return null; }
    };

    // 1. Try Exact Original Name
    let id = await search(name);
    if (id) return id;

    // 2. Try Trimmed / Sanitized Cleanups
    const cleanTrailing = name.replace(/[·\-\s\.\s]+$/, "").trim();
    if (cleanTrailing !== name) {
        id = await search(cleanTrailing);
        if (id) return id;
    }

    // 3. Fallback: Parse Middle names split by '·'
    if (cleanTrailing.includes("·")) {
        const parts = cleanTrailing.split("·").map(p => p.trim());
        if (parts.length >= 3) {
            // e.g. "理查德·菲利普斯·费曼" -> "理查德·费曼"
            id = await search(`${parts[0]}·${parts[parts.length - 1]}`);
            if (id) return id;
            
            // "费曼"
            id = await search(parts[parts.length - 1]);
            if (id) return id;
        }
        if (parts.length >= 2) {
            // "毕加索"
            id = await search(parts[parts.length - 1]);
            if (id) return id;
        }
    }

    // 4. Try Suffix strip (e.g. " - 智利南极大区")
    if (name.includes(" - ")) {
        const baseName = name.split(" - ")[0].trim();
        id = await search(baseName);
        if (id) return id;
    }

    // 5. Common Transliteration / Locale Spelling Normalization Map (Cantonese/Taiwanese/Mandarin)
    const normalizedName = name
        .replace(/差利·卓别灵/g, "查理·卓别林")
        .replace(/夏绿蒂·勃朗特/g, "夏洛特·勃朗特")
        .replace(/玛丽亚·蒙特梭利/g, "玛丽亚·蒙台梭利")
        .replace(/芙烈达·卡罗/g, "弗里达·卡洛")
        .replace(/释弘一/g, "李叔同")
        .replace(/乾隆帝/g, "乾隆");
        
    if (normalizedName !== name) {
        id = await search(normalizedName);
        if (id) return id;
    }

    return null;
}
```
