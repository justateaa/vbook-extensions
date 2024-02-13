function execute(url) {
    let chapters = [];

    let result = fetch(url);

    if (!result.ok) return null;

    let elements = result.html().select("div.entry-content details > div a");

    for (let i = 0; i < elements.length; i++) {
        let elm = elements.get(i);

        let href = elm.attr("href");

        if (!/littlethingbutspecial\.wordpress\.com\/\d{4}\/\d{2}\/\d{2}\/[\w-]+\/?/.test(href)) {
            continue;
        }
        
        chapters.push({
            url: href,
            name: elm.text(),
            host: "https://littlethingbutspecial.wordpress.com/",
        });
    }

    return Response.success(chapters);
}
