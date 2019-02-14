const rp = require('request-promise');
const cheerio = require('cheerio'); // Basically jQuery for node.js
const fs = require('fs');

/**
 * @param splitStr 默认的分隔符是 -
 * @param {*} param0
 */
function __list({$, elem, type = 'ul', splitStr = '-', index = 0}) {
    let subNodeName = 'li'; // 默认的子节点是li 实际上ol,ul的子节点都是li
    let markdown = ``;
    splitStr += `\t`; // 默认的分隔符是 制表符
    if (type == 'ol') {
        splitStr = `${index}.\t` // 如果是ol类型的 则是从0开始的index 实际上这一步有点多余,在下文有做重新替换
    }
    $(elem).find(`> ${subNodeName}`).each((subIndex, subElem) => {
        const $subList = $(subElem).find(type); //当前子节点下面是否有ul || ol 标签?
        if ($subList.length <= 0) {
            if (type == 'ol') {
                splitStr = splitStr.replace(index, index + 1); // 如果是ol标签 则开始符号为 1. 2. 3. 这种类型的
                index++;
            }
            return markdown += `${splitStr} ${$(subElem).text()} \r\n`
        } else {
            // 如果存在 ul || ol 则进行二次递归处理
            let nextSplitStr = splitStr + '-';
            if (type == 'ol') {
                nextSplitStr = splitStr.replace(index, index + 1);
            }
            const res = __list({$, elem: $subList, type, splitStr: nextSplitStr, index: index + 1}); // 递归处理当前内部的ul节点
            markdown += res;
        }
    });
    return markdown;
}

const ruleFunc = {
    h1: function ($, elem) {
        return `# ${$(elem).text()} \r\n`;
    },
    h2: function ($, elem) {
        return `## ${$(elem).text()} \r\n`;
    },
    h3: function ($, elem) {
        return `### ${$(elem).text()} \r\n`;
    },
    h4: function ($, elem) {
        return `#### ${$(elem).text()} \r\n`;
    },
    h5: function ($, elem) {
        return `##### ${$(elem).text()} \r\n`;
    },
    p: function ($, elem) {
        let markdown = '';
        const $subElem = $(elem).contents(); // 获取当前p标签下的所有子节点
        $subElem.each((index, subElem) => {
            const type = subElem.type; // 当前子节点的type是 text 还是 tag
            let name = subElem.name || type; // name属性===nodeName 也就是当前标签名
            name = name.toLowerCase();
            if (ruleFunc[name]) { // 是否在当前解析规则找到
                let res = ruleFunc[name]($, subElem); // 如果找到的话则递归解析
                if (name != 'br' || name != 'text') { // 如果当前节点不是br或者文本节点 都把\r\n给去掉,要不然会出现本来一行的文本因为中间加了某些内容会换行
                    res = res.replace(/\r\n/gi, '');
                }
                markdown += res;
            }
        });
        return markdown + '\r\n'; // \r\n为换行符
    },
    div:function ($,elem) {
        return ruleFunc['p']($,elem);
    },
    // 暂时不考虑...table的实现 蛋疼
    table:function ($,elem) {
        if(elem){
            return ` \`\`\` \r\n ${$(elem).html()} \`\`\` \r\n `;
        }else{
            return ` Sorry~ 文章的某段内容在迁移的时候被不可视之力吞噬了 `;
        }

    },
    "text": function ($, elem) {
        return `${$(elem).text()}\r\n`;
    },
    code: function ($, elem) {
        return `\`${$(elem).text()}\`\r\n`;
    },
    br: function () {
        return `\r\n`;
    },
    a: function ($, elem) {
        if ($(elem).attr("id") == 'more') {
            return `\r\n`;
        }
        return `[${$(elem).text()}](${$(elem).attr('href')}) \r\n`;
    },
    img: function ($, elem) {
        return `![${$(elem).text()}](${$(elem).attr('src')}) \r\n`;
    },
    ul: function ($, elem) {
        const name = elem.name.toLowerCase();
        return __list({$, elem, type: name})
    },
    ol: function ($, elem) {
        const name = elem.name.toLowerCase();
        return __list({$, elem, type: name})
    },
    blockquote: function ($, elem) {
        const res = $(elem).text();
        return `> ${res}`;
    },
    figure:function ($,elem) {
        const $line = $(elem).find('.code pre .line');
        let text = '';
        $line.each((index,elem)=>{
            text+=`${$(elem).text()} \r\n`;
        });
        return ` \`\`\` \r\n ${text} \`\`\` \r\n---`
    },
    hr:function ($,elem) {
        return ` --- \r\n`
    }
};

function __transform($, $contentSubElemList) {
    let markdown = '';
    $contentSubElemList.each((index, elem) => {
        const name = elem.name.toLowerCase();
        if (!ruleFunc[name]) {
            return console.error(`${name}解析规则未找到`);
        }
        markdown += ruleFunc[name]($, elem) + '\r\n';
    });
    return markdown;
}

async function html2Markdown({url}) {
    const options = {
        uri: url,
        transform: function (body) {
            return cheerio.load(body);
        }
    };
    console.info(`get:${url} done`);
    const $ = await rp(options);
    const $content = $('.article-entry');
    const title = $('.article-title').text();
    const $tag = $('.article-tag-list li');
    const time = $('time').attr('datetime');
    const tagArr = [];
    let markdown = __transform($, $('.article-entry').find('> *'));
    $tag.each((index, elem) => {
        tagArr.push({name: $(elem).text()})
    });

    fs.writeFileSync(`./md/${title}.md`, markdown);
    console.info('输出完毕');

    await postBlog({markdown, tags: tagArr, title, time});
};

async function postBlog({markdown, title, tags, time}) {
    const mobiledoc =
        {
            "version": "0.3.1",
            "atoms": [],
            "cards": [["markdown", {"markdown": markdown}]],
            "markups": [],
            "sections": [[10, 0], [1, "p", []]]
        };

    var options = {
        method: 'POST',
        uri: 'https://www.relsoul.com/ghost/api/v0.1/posts/',
        body: {
            "posts": [{
                "title": title,
                "mobiledoc": JSON.stringify(mobiledoc),
                "status": "published",
                "published_at": time,
                "published_by": "1",
                tags: tags,
                "created_at": time,
                "created_by": time
            }]
        },
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: "Bearer token"
        },
        json: true // Automatically stringifies the body to JSON
    };

    const res = await rp(options);
    if (res['posts']) {
        console.log('插入成功', title)
    } else {
        console.error('插入失败', res);
    }

}

// html2Markdown({url: 'http://127.0.0.1:8080/2016/10/24/VuexDemo%E5%AD%A6%E4%B9%A0%E8%AE%B0%E5%BD%95/'});


async function getUrl(url) {

    let list = []
    const options = {
        uri: url,
        transform: function (body) {
            return cheerio.load(body);
        }
    };
    console.info(`获取URL:${url} done`);
    const $ = await rp(options);
    let $urlList = $('.archives-wrap .archive-article-title');
    $urlList.each((index, elem) => {
        list.push($(elem).attr('href'))
    });
    return list;
}

async function start() {
    let list = [];
    let url = `http://127.0.0.1:8080/archives/`;
    list.push(...await getUrl(url));

    for (let i = 2; i <=9; i++) {
        let currentUrl = url +'page/'+ i;
        list.push(...await getUrl(currentUrl));
    }

    console.log('所有页面获取完毕',list);

    for(let i of list){
       await html2Markdown({url:`http://127.0.0.1:8080${encodeURI(i)}`})
    }
}

start()