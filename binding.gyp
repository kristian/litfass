{
    "targets": [
        {
            "target_name": "displays",
            "sources": ["displays.cc"],
            "include_dirs": [ "<!(node -e \"require('nan')\")" ]
        }
	]
}