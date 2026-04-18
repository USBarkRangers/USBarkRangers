from html.parser import HTMLParser

class DivParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []
        self.line_offset = 0

    def handle_starttag(self, tag, attrs):
        if tag == 'div':
            attr_dict = dict(attrs)
            self.stack.append((attr_dict.get('id', ''), attr_dict.get('class', ''), self.getpos()[0]))

    def handle_endtag(self, tag):
        if tag == 'div':
            if self.stack:
                popped = self.stack.pop()
                # print(f"Closed div {popped[0]} from line {popped[2]} at line {self.getpos()[0]}")
            else:
                print(f"EXTRA </div> at line {self.getpos()[0]}")

parser = DivParser()
with open('index.html', 'r', encoding='utf-8') as f:
    parser.feed(f.read())

if parser.stack:
    print(f"UNCLOSED DIVS:")
    for id_val, class_val, line in parser.stack:
        print(f"Line {line}: id='{id_val}' class='{class_val}'")
