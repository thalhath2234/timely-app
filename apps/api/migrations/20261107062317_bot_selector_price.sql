-- +goose Up
-- A page watch may follow one price on the page: read_mode selector_price
-- reads the part a CSS selector picks and takes the price in it, so it needs
-- a selector like a selector read.
ALTER TABLE bot_watches DROP CONSTRAINT bot_watches_read_mode_check;
ALTER TABLE bot_watches ADD CONSTRAINT bot_watches_read_mode_check
    CHECK (read_mode IN ('', 'text', 'selector', 'product_price', 'selector_price'));
ALTER TABLE bot_watches DROP CONSTRAINT bot_watches_shape_check;
ALTER TABLE bot_watches ADD CONSTRAINT bot_watches_shape_check CHECK (
    (kind = 'page' AND url <> '' AND read_mode <> '' AND source = '' AND (read_mode NOT IN ('selector', 'selector_price') OR selector <> ''))
    OR (kind = 'feed' AND url <> '' AND read_mode = '' AND source = '')
    OR (kind = 'price' AND url = '' AND read_mode = '' AND source <> '' AND symbol <> ''));

-- +goose Down
DELETE FROM bot_watches WHERE read_mode = 'selector_price';
ALTER TABLE bot_watches DROP CONSTRAINT bot_watches_shape_check;
ALTER TABLE bot_watches ADD CONSTRAINT bot_watches_shape_check CHECK (
    (kind = 'page' AND url <> '' AND read_mode <> '' AND source = '' AND (read_mode <> 'selector' OR selector <> ''))
    OR (kind = 'feed' AND url <> '' AND read_mode = '' AND source = '')
    OR (kind = 'price' AND url = '' AND read_mode = '' AND source <> '' AND symbol <> ''));
ALTER TABLE bot_watches DROP CONSTRAINT bot_watches_read_mode_check;
ALTER TABLE bot_watches ADD CONSTRAINT bot_watches_read_mode_check
    CHECK (read_mode IN ('', 'text', 'selector', 'product_price'));
