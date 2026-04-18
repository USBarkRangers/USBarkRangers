from html.parser import HTMLParser

class MyHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []

    def handle_starttag(self, tag, attrs):
        if tag in ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']:
            return
        
        attr_dict = dict(attrs)
        self.stack.append((tag, attr_dict.get('id', ''), attr_dict.get('class', '')))
        
        if tag == 'nav' and attr_dict.get('id') == 'main-nav':
            print(f"FOUND NAV! Path: {' > '.join(f'{t}{f'#{i}' if i else ''}' for t, i, c in self.stack)}")

    def handle_endtag(self, tag):
        if tag in ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']:
            return
            
        if not self.stack:
            print(f"ERROR: End tag </{tag}> with empty stack!")
            return
            
        expected = self.stack[-1][0]
        if expected != tag:
            print(f"ERROR: Expected </{expected}>, got </{tag}>. Stack: {self.stack[-3:]}")
        
        self.stack.pop()

parser = MyHTMLParser()
with open('index.html', 'r', encoding='utf-8') as f:
    parser.feed(f.read())

print(f"Final stack size: {len(parser.stack)}")
if parser.stack:
    print(f"Remaining stack: {parser.stack}")
