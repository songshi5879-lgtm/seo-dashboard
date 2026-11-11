import unittest

from pipeline.readers import merge_gsc_anchors


class AnchorMergeTest(unittest.TestCase):
    def test_main_row_preserves_rank_and_impressions_and_adds_clicks(self):
        rows = [
            {"key": "https://example.com/blog#one", "clicks": 2, "impressions": 1000, "position": 10},
            {"key": "https://example.com/blog", "clicks": 4, "impressions": 200, "position": 5},
            {"key": "https://example.com/blog#two", "clicks": 1, "impressions": 500, "position": 15},
        ]
        warnings = []
        self.assertEqual(merge_gsc_anchors(rows, warnings, "GSC"), [
            {"path": "/blog", "clicks": 7, "impressions": 200, "position": 5},
        ])
        self.assertIn("GSC 锚点：/blog", warnings)

    def test_missing_main_row_preserves_other_url_identities_and_query_grain(self):
        def row(url, query, impressions, clicks, position):
            return dict(key=url, query=query, impressions=impressions, clicks=clicks, position=position)

        rows = [
            row("/products/item#a", "query", 1, 1, 2),
            row("/products/item#b", "query", 20, 2, 3),
            row("/products/item?variant=1#a", "query", 10, 1, 4),
            row("/products/Item#a", "query", 11, 1, 5),
            row("/collections/test/products/item#a", "query", 12, 1, 6),
            row("/products/item#a", "different query", 13, 1, 7),
        ]
        result = merge_gsc_anchors(rows, [], "Looker", by_query=True)
        self.assertEqual(len(result), 5)
        self.assertEqual(result[0], {
            "path": "/products/item", "query": "query", "impressions": 20, "clicks": 3, "position": 3,
        })
        self.assertEqual(
            [(r["path"], r["query"]) for r in result[1:]],
            [
                ("/products/item?variant=1", "query"),
                ("/products/Item", "query"),
                ("/collections/test/products/item", "query"),
                ("/products/item", "different query"),
            ],
        )


if __name__ == "__main__":
    unittest.main()
