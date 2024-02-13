function execute(url) {
    let result = fetch(url);

    if (!result.ok) return null;

    let dom = result.html();

    dom.select("script").remove();
    dom.select("ul").remove();

    let content = dom.select("div.entry-content").html().replace(/&nbsp;/g, " ");

    return Response.success(content);
}
