var Readable = require('stream').Readable
var request		= require('request');
var EventEmitter	= require('events').EventEmitter;
var mime		= require('mime');
var util		= require('util');

function resumableUpload() {
	this.byteCount	= 0; //init variables
	this.tokens	= {};
	this.filepath	= '';
	this.retry	= -1;
	this.host	= 'www.googleapis.com';
	this.metadata = {};
};

util.inherits(resumableUpload, EventEmitter);

//Init the upload by POSTing google for an upload URL (saved to self.location)
resumableUpload.prototype.upload = function() {
	var self = this;
	var options = {
		url:	'https://' + self.host + self.api + '?uploadType=resumable',
		headers: {
		  'Host':			self.host,
		  'Authorization':		'Bearer ' + self.tokens.access_token,
		  'Content-Length':		self.metadata.length,
		  'Content-Type':		'application/json',
		  'X-Upload-Content-Length':	self.content.length,
		  'X-Upload-Content-Type': 	'message/rfc822'
		},
		body: JSON.stringify(self.metadata)
	};
	//Send request and start upload if success
	const callback = function(err, res, body) {
		if (err || !res.headers.location) {
			self.emit('error', new Error(err));
			self.emit('progress', 'Retrying ...');
			if ((self.retry > 0) || (self.retry <= -1)) {
				self.retry--;
				self.upload(); // retry
			} else {
				return;
			}
		}
		self.location = res.headers.location;
		self.send();
	}
	if (self.method === 'PUT') {
		request.put(options, callback);
	} else {
		request.post(options, callback);
	}
}

//Pipes uploadPipe to self.location (Google's Location header)
resumableUpload.prototype.send = function() {
	var self = this;
	var options = {
		url: self.location, //self.location becomes the Google-provided URL to PUT to
		headers: {
		  'Authorization':	'Bearer ' + self.tokens.access_token,
		  'Content-Length':	self.content.length - self.byteCount,
		  'Content-Type':	'message/rfc822'
		}
	};
	try {
		//creates file stream, pipes it to self.location
		var uploadPipe = new Readable
		uploadPipe.push(self.content)    // the string you want
		uploadPipe.push(null)
	} catch (e) {
		self.emit('error', new Error(e));
		return;
	}
	var health = setInterval(function(){
		self.getProgress(function(err, res, body) {
			if (!err && typeof res.headers.range !== 'undefined') {
				self.emit('progress', res.headers.range.substring(8));
			}
		});
	}, 5000);
	uploadPipe.pipe(request.put(options, function(error, response, body) {
		clearInterval(health);
		if (!error) {
			self.emit('success', body);
			return;
		}
		self.emit('error', new Error(error));
		if ((self.retry > 0) || (self.retry <= -1)) {
			self.retry--;
			self.getProgress(function(err, res, b) {
				if (typeof res.headers.range !== 'undefined') {
					self.byteCount = res.headers.range.substring(8); //parse response
				} else {
					self.byteCount = 0;
				}
				self.send();
			});
		}
	}));
}

resumableUpload.prototype.getProgress = function(handler) {
	var self = this;
	var options = {
		url: self.location,
		headers: {
		  'Authorization':	'Bearer ' + self.tokens.access_token,
		  'Content-Length':	0,
		  'Content-Range':	'bytes */' + self.content.length
		}
	};
	request.put(options, handler);
}

module.exports = resumableUpload;
