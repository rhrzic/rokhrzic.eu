---
layout: default
title: Blog
permalink: /blog/
---

## Latest

{% for post in site.posts %}

[{{ post.title }}]({{ post.url }})

{{ post.date | date_to_string}}

{{ post.excerpt }}

{% endfor %}
