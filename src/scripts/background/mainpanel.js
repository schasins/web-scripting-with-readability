/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

var PortManager = (function PortManagerClosure() {
  var portLog = getLog('ports');

  function PortManager() {
    this.numPorts = 0;
    this.ports = {};
    this.portNameToTabId = {};
    this.portNameToPortInfo = {};
    this.tabIdToPortNames = {};
    this.tabIdToCurrentPortInfo = {};
    this.portToSnapshot = {};
    this.tabIdToTab = {};
    this.ack = null;
  }

  PortManager.prototype = {
    sendToAll: function(message) {
      portLog.log('sending to all:', message);
      var ports = this.ports;
      for (var portName in ports) {
        ports[portName].postMessage(message);
      }
    },
    getTab: function(portName) {
      return this.portNameToTabId[portName];
    },
    getTabInfo: function(tab) {
      return this.tabIdToCurrentPortInfo[tab];
    },
    getTabFromTabId: function(tabId) {
      return this.tabIdToTab[tabId];
    },
    getPort: function(portName) {
      return this.ports[portName];
    },
    getSnapshot: function(portName) {
      return this.portToSnapshot[portName];
    },
    addSnapshot: function(name, snapshot) {
      this.portToSnapshot[name] = snapshot;
    },
    updateUrl: function(port, url) {
      this.portNameToPortInfo[port.name].URL = url;
    },
    getNewId: function(value, sender) {
      this.numPorts++;
      var portName = '' + this.numPorts;

      portLog.log('adding new id: ', portName, value);

      // Update various mappings
      var tabId = sender.tab.id;

      this.tabIdToTab[tabId] = sender.tab;
      this.portNameToTabId[portName] = tabId;
      this.portNameToPortInfo[portName] = value;

      var tabIdToPortNames = this.tabIdToPortNames;
      if (!(tabId in tabIdToPortNames)) {
        tabIdToPortNames[tabId] = [];
      }
      tabIdToPortNames[tabId].push(portName);

      value.portName = portName;

      if (value.top) {
        this.tabIdToCurrentPortInfo[tabId] = {top: value, frames: []};
      } else {
        var portInfo = this.tabIdToCurrentPortInfo[tabId];
        portInfo.frames.push(value);
      }
      return portName;
    },
    connectPort: function(port) {
      var portName = port.name;
      var ports = this.ports;

      ports[portName] = port;

      port.onMessage.addListener(function(msg) {
        handleMessage(port, msg);
      });

      var portManager = this;
      port.onDisconnect.addListener(function(evt) {
        portLog.log('disconnect port:', port);

        if (portName in ports) {
          delete ports[portName];
        } else {
          throw "Can't find port";
        }

        var tabIdToCurrentPortInfo = portManager.tabIdToCurrentPortInfo;
        var tabId = portManager.portNameToTabId[portName];
        var portInfo = portManager.tabIdToCurrentPortInfo[tabId];

        if (portInfo.top.portName == portName) {
          delete tabIdToCurrentPortInfo[tabId];
        } else {
          var frames = portInfo.frames;
          for (var i = 0, ii = frames.length; i < ii; ++i) {
            if (frames[i].portName == portName) {
              frames.splice(i, 1);
              break;
            }
          }
        }
      });
    },
    getAck: function() {
      return this.ack;
    },
    setAck: function(val) {
      portLog.log('set ack:', val);
      this.ack = val;
    },
    clearAck: function() {
      portLog.log('clear ack');
      this.ack = null;
    }
  };

  return PortManager;
})();

var Panel = (function PanelClosure() {
  function Panel(controller, ports) {
    this.controller = controller;
    this.ports = ports;

    this.loadParams();
    this.attachHandlers(controller);

    var total = $('#top').height();
    var header = $('#headerDiv').height();
    var containerHeight = window.innerHeight - header - 16;

    $('#container').css('height', containerHeight + 'px');
  }

  Panel.prototype = {
    attachHandlers: function _attachHandlers(controller) {
      $('#start').click(function(eventObject) {
        controller.start();
      });

      $('#stop').click(function(eventObject) {
        controller.stop();
      });

      $('#reset').click(function(eventObject) {
        controller.reset();
      });

      $('#replay').click(function(eventObject) {
        controller.replayScript();
      });

      $('#pause').click(function(eventObject) {
        controller.pause();
      });

      $('#restart').click(function(eventObject) {
        controller.restart();
      });

      $('#skip').click(function(eventObject) {
        controller.skip();
      });

      $('#resend').click(function(eventObject) {
        controller.resend();
      });

      $('#paramsDiv').hide(1000);

      $('#paramsHide').click(function(eventObject) {
        $('#paramsDiv').toggle(1000);
      });

      $('#save').click(function(eventObject) {
        var name = $('#scriptname').prop('value');
        controller.saveScript(name);
      });

      $('#load').click(function(eventObject) {
        var name = $('#scriptname').prop('value');
        controller.getScript(name);
      });

      var panel = this;
      // when the form is submitted, the parameters should be dispatched to the
      // content scripts so that everything is kept insync
      $('#params').change(function(eventObject) {
        panel.updateParams();
        panel.ports.sendToAll({type: 'params', value: params});
        return false;
      });
    },
    loadParams: function _loadParams() {
      // create a form based on parameters
      var loadParamForm = function(node, paramObject, prefix) {
        for (var param in paramObject) {
          var paramValue = paramObject[param];
          var paramType = typeof paramValue;
          var name = prefix + '.' + param;

          if (paramType == 'number') {
            var input = $('<input type=text name=' + name + '></input>');
            input.prop('value', paramValue);

            var newDiv = $('<div>' + param + '</div>');
            newDiv.append(input);
            node.append(newDiv);
          } else if (paramType == 'boolean') {
            var input = $('<input type=checkbox name=' + name + '></input>');
            input.prop('checked', paramValue);

            var newDiv = $('<div>' + param + '</div>');
            newDiv.append(input);
            node.append(newDiv);
          } else if (paramType == 'object') {
            var newDiv = $("<div class='boxed'></div>");
            newDiv.append('<div>' + param + '</div>');
            loadParamForm(newDiv, paramValue, name);
            node.append(newDiv);
          }
        }
      };

      var form = $('#params');
      loadParamForm(form, params, 'params');
    },
    updateParams: function _updateParams() {
      var obj = {};
      var inputs = $('#params').prop('elements');
      for (var i = 0, ii = inputs.length; i < ii; ++i) {
        var input = inputs[i];

        var val;
        if (input.type == 'checkbox') {
          val = input.checked;
        } else if (input.type == 'text') {
          val = parseInt(input.value);
        } else {
          continue;
        }
        var names = input.name.split('.');

        var cur = params;
        for (var j = 1, jj = names.length - 1; j < jj; ++j) {
          var key = names[j];
          if (!(key in cur)) {
            cur[key] = {};
          }
          cur = cur[key];
        }
        cur[names[names.length - 1]] = val;
      }
    },
    addEvent: function _addEvent(eventRecord) {
      //var eventInfo = eventRecord.msg.value;
      var id = eventRecord.id;
      var tab = eventRecord.tab;
      var topURL = eventRecord.topURL;
      var portName = eventRecord.port;
      var topFrame = eventRecord.topFrame;
      var iframeIndex = eventRecord.iframeIndex;
      var waitTime = eventRecord.waitTime;
      var display = eventRecord.display;
      var target = eventRecord.target;
      var divergingProps = eventRecord.divergingProps;


      var newDiv = "<div class='event wordwrap' id='" + id + "'>";

      newDiv += '<b>[' + id + ']type:' + '</b>' + eventRecord.type +
                '<br/>';
      newDiv += display + '<br/>';
      newDiv += '<b>target:' + '</b>' + target + '<br/>';
      //newDiv += eventRecord.events[0].msg.value.html + '</br>';
      for (var i = 0 ; i < divergingProps.length ; i++){
		  var prop = divergingProps[i];
		  newDiv += '<b>change:' + '</b>' + prop.prop + ': ' + prop.original + '->' + prop.final + '<br/>';
	  }
      //newDiv += '<b>tab:' + '</b>' + tab + '<br/>';
      //newDiv += '<b>topURL:' + '</b>' + topURL + '<br/>';
      //newDiv += '<b>port:' + '</b>' + portName + '<br/>';
      //newDiv += '<b>topFrame:' + '</b>' + topFrame + '<br/>';
      //newDiv += '<b>iframeIndex:' + '</b>' + iframeIndex + '<br/>';
      //newDiv += '<b>waitTime:' + '</b>' + waitTime + '<br/>';

      newDiv += '</div>';
      $('#events').append(newDiv);
    },
    clearEvents: function _clearEvents() {
      $('#events').empty();
    },
    startRecording: function _startRecording() {
      $('#status').text('Recording');
    },
    stopRecording: function _stopRecording() {
      $('#status').text('Stopped');
    }
  };

  return Panel;
})();

var Record = (function RecordClosure() {
  var recordLog = getLog('record');

  function Record(ports) {
    this.ports = ports;
    this.events = [];
    this.recentEvents = [];
    this.interpretedEvents = [];
    this.eventsToSend = [];
    this.comments = [];
    this.replayEvents = [];
    this.replayComments = [];
    this.commentCounter = 0;
    this.recordState = RecordState.STOPPED;
    this.simultaneousReplayer = null;
    this.lastTime = 0;
    this.loadedScriptId = null;
  }

  Record.prototype = {
    setPanel: function _setPanel(panel) {
      this.panel = panel;
    },
    setSimultaneousReplayer: function(simultaneousReplayer) {
      this.simultaneousReplayer = simultaneousReplayer;
    },
    getStatus: function _getStatus() {
      return this.recordState;
    },
    startRecording: function _startRecording() {
      recordLog.log('starting record');

      this.recordState = RecordState.RECORDING;
      this.panel.startRecording();

      // Tell the content scripts to begin recording
      this.ports.sendToAll({type: 'recording', value: this.getStatus()});
    },
    stopRecording: function _stopRecording() {
      recordLog.log('stoping record');

      this.recordState = RecordState.STOPPED;
      this.panel.stopRecording();

      // Tell the content scripts to stop recording
      this.ports.sendToAll({type: 'recording', value: this.getStatus()});
    },
    startReplayRecording: function _startReplayRecording() {
      this.recordState = RecordState.REPLAYING;

      this.replayEvents = [];
      this.replayComments = [];
      this.commentCounter = 0;
      this.ports.sendToAll({type: 'recording', value: this.getStatus()});
    },
    stopReplayRecording: function _stopReplayRecording() {
      this.stopRecording();
    },
    addComment: function _addComment(eventRequest, portName) {
      var value = eventRequest.value;
      var comment = {};
      comment.name = value.name;
      comment.value = value.value;

      recordLog.log('added comment:', comment, portName);

      if (this.recordState == RecordState.RECORDING) {
        comment.execution_order = this.events.length + (0.01 *
            (this.commentCounter + 1));
        this.comments.push(comment);
      } else if (this.recordState == RecordState.REPLAYING) {
        comment.execution_order = this.replayEvents.length + (0.01 *
            (this.commentCounter + 1));
        this.replayComments.push(comment);
      }
      this.commentCounter += 1;
    },
    addEvent: function _addEvent(eventRequest, portName) {
      var ports = this.ports;
      var tab = ports.getTab(portName);
      var portInfo = ports.getTabInfo(tab);
      var topURL = portInfo.top.URL;

      // don't record this action if it's being generated by our simultaneous
      // replay
      var window = this.ports.getTabFromTabId(tab).windowId;
      if (window == this.simultaneousReplayer.twinWindow) {return}

      var topFrame = false;
      var iframeIndex = -1;

      if (portInfo.top.portName == portName) {
        topFrame == true;
      } else {
        var frames = portInfo.frames;
        for (var i = 0, ii = frames.length; i < ii; ++i) {
          var frame = frames[i];
          if (frame.portName == portName) {
            iframeIndex = i;
            break;
          }
        }
      }
      var topFrame = (portInfo.top.portName == portName);

      var time = eventRequest.value.timeStamp;
      var lastTime = this.lastTime;
      if (lastTime == 0) {
        var waitTime = 0;
      } else {
        var waitTime = time - lastTime;
      }
      this.lastTime = time;

      var eventRecord = {msg: eventRequest, port: portName, topURL: topURL,
          topFrame: topFrame, iframeIndex: iframeIndex, tab: tab,
          waitTime: waitTime};

      recordLog.log('added event:', eventRequest, portName, eventRecord);

      if (this.recordState == RecordState.RECORDING) {
        this.loadedScriptId = null;

        var events = this.events;
        eventRecord.id = 'event' + events.length;

        this.events.push(eventRecord);
        
        var sameEventCategory, sameTarget = false;
        if (this.recentEvents.length > 0){
	        sameEventCategory = this.eventCategory(eventRecord) == this.eventCategory(this.recentEvents[0]);
	        sameTarget = eventRecord.msg.value.target == this.recentEvents[0].msg.value.target;
	    }
        if (this.recentEvents.length == 0 || (sameEventCategory && sameTarget)){
        	recordLog.log("same list: ");
        	recordLog.log(eventRecord);
        	this.recentEvents.push(eventRecord);
        }
        else{
        	//found an event with a new target
        	this.newInterpretedEvent();
        	this.recentEvents = [eventRecord]; //time to start a new recentEvents
        }
        /*
        this.panel.addEvent(eventRecord);
        if (params.simultaneous) {
          this.simultaneousReplayer.simultaneousReplay(eventRecord);
        }
        */
      } else if (this.recordState == RecordState.REPLAYING) {
        var replayEvents = this.replayEvents;
        eventRecord.id = 'event' + replayEvents.length;

        replayEvents.push(eventRecord);
      }
      this.commentCounter = 0;
    },
    newInterpretedEvent: function _newInterpretedEvent(){
		if (this.recentEvents.length < 1){
			return;
		}
		var interpretedEvent = this.interpretEvents(this.recentEvents);
		this.interpretedEvents.push(interpretedEvent);
		this.panel.addEvent(interpretedEvent);
		this.addEventsToSend(interpretedEvent);
		this.recentEvents = [];
	},
	makeEvent: function _makeEvent(msg,sampleEvent){
		var event = {msg:msg};
		var necessaryProps = ["port","tab","id","topURL","topFrame","iframeIndex","snapshot","target"];
		for (var i = 0; i<necessaryProps.length; i++){
			var prop = necessaryProps[i];
			event[prop] = sampleEvent[prop];
		}
		event["snapshot"] = sampleEvent.msg.value.snapshot;
		event["target"] = sampleEvent.msg.value.target;
		return event;
	},
	addEventsToSend: function _addEventsToSend(interpretedEvent){
		if (interpretedEvent.type == "select"){
			var msg = {type:"select", target: interpretedEvent.target, index: interpretedEvent.index, text: interpretedEvent.text};
			var event = this.makeEvent(msg,interpretedEvent.events[0]);
			this.eventsToSend.push(event);
		}
		if (interpretedEvent.type == "type"){
			var e = interpretedEvent.events[0];
			e.target = interpretedEvent.target;
			e.type = "type";
			e.msg.type = "type";
			e.msg.extensionProperty = "data";
			e.msg.extensionValue = interpretedEvent.props.value;
			this.eventsToSend.push(e);
		}
		else{
			var eventsToSend = this.eventsToSend;
			_.each(interpretedEvent.events, function(e){e.target=interpretedEvent.target; eventsToSend.push(e);});
		}
		
		/*
		for (var prop in interpretedEvent.props){
			var msg = {type:"propertyReplacement", target:interpretedEvent.target, prop:prop, value:interpretedEvent.props[prop]};
			console.log(msg.prop);
			console.log(msg.value);
			var event = {msg:msg};
			var necessaryProps = ["port","tab","id","topURL","topFrame","iframeIndex","snapshot","target"];
			var firstEvent = interpretedEvent.events[0];
			for (var i = 0; i<necessaryProps.length; i++){
				var prop = necessaryProps[i];
				event[prop] = firstEvent[prop];
			}
			event["snapshot"] = firstEvent.msg.value.snapshot;
			event["target"] = interpretedEvent.target;
			this.eventsToSend.push(event);
		}
		*/
		
	},
    eventCategory: function _eventCategory(eventMsg){
    	var eventType = eventMsg.msg.value.type;
    	if (["click","mouseup","mousedown"].indexOf(eventType) > -1){
    		return "click";
    	}
    	if (["textInput","keypress","keyup","keydown","input"].indexOf(eventType) > -1){
    		return "type";
    	}
    	else {
    		return "unknown";
    	}
    },
    updateEvent: function _updateEvent(eventRequest, portName) {
      var events = this.events;
      var updates = eventRequest.value;
      var pageEventId = updates.pageEventId;

      for (var i = events.length - 1; i >= 0; --i) {
        var e = events[i];
        var msgValue = e.msg.value;
        if (e.port == portName && msgValue.pageEventId == pageEventId) {
          for (key in updates) {
            msgValue[key] = updates[key];
          }
          break;
        }
      }
    },
    divergingProps: function _divergingProps(eventRecord1,eventRecord2){
	  var obj1 = eventRecord1.msg.value.targetSnapshot;
	  var obj2 = eventRecord2.msg.value.targetSnapshot;
	  if (!(obj1 && obj2 && obj1.prop && obj2.prop)) {
		console.log('DIVERGING PROP WEIRDNESS ', obj1, obj2);
		return [];
	  }
	  var obj1props = _.omit(obj1.prop, params.synthesis.omittedProps);
	  var obj2props = _.omit(obj2.prop, params.synthesis.omittedProps);

	  var divergingProps = [];
	  for (var prop in obj1props) {
		if (obj1props[prop] != obj2props[prop]) {
		  divergingProps.push({prop: prop, original: obj1props[prop], final: obj2props[prop]});
		}
	  }
	  return divergingProps;
	},
    interpretEvents: function _interpretEvents(listOfEvents){
    	var interpretedEvent = [];
    	interpretedEvent['target'] = listOfEvents[0].msg.value.target;
    	interpretedEvent['events'] = listOfEvents;
    	interpretedEvent['divergingProps'] = this.divergingProps(listOfEvents[0],listOfEvents[listOfEvents.length-1]);
    	interpretedEvent['props'] = {};
    	
    	/*
		for (var i = 0; i< interpretedEvent['divergingProps'].length; i++){
			var prop = interpretedEvent['divergingProps'][i].prop;
			interpretedEvent['props'][prop] = interpretedEvent['divergingProps'][i].final;
			console.log("interpreted event: "+ prop +" "+ interpretedEvent['props'][prop]);
		}
		*/
		
		var targetNodeName = listOfEvents[0].msg.value.nodeName;
		
    	if (targetNodeName == "select"){
    		//it's a select
    		interpretedEvent['type'] = 'select';
    		var lastEventProps = listOfEvents[listOfEvents.length-1].msg.value.targetSnapshot.prop;
    		var selectedIndex = lastEventProps.selectedIndex;
    		var outerHTML = $(lastEventProps.outerHTML);
    		var optionText = outerHTML.children()[selectedIndex].innerText;
    		interpretedEvent['display'] = "You selected: "+optionText;
    		interpretedEvent['index'] = selectedIndex;
    		interpretedEvent['text'] = optionText;
    	}
    	else if (this.eventCategory(listOfEvents[0])=="click"){
    		//it's a click!
    		interpretedEvent['type'] = 'click';
    		interpretedEvent['display'] = "You clicked.";
    	}
    	else if (this.eventCategory(listOfEvents[0])=="type"){
    		//it's typing
    		interpretedEvent['type'] = 'type';
    		interpretedEvent['props'].value = listOfEvents[listOfEvents.length-1].msg.value.targetSnapshot.prop.value;
    		interpretedEvent['display'] = "You typed: '"+interpretedEvent['props']['value']+"'.";
    	}
    	else{
    		interpretedEvent['type'] = listOfEvents[0].msg.value.type;
    		interpretedEvent['display'] = listOfEvents[0].msg.value.type;
    	}
    	return interpretedEvent;
    },
    eventTypesAre: function _eventTypesAre(listOfEvents,eventTypes){
    	var acc = true;
    	for (var i = 0; i < listOfEvents.length; i++){
    		//console.log(eventTypes);
    		//console.log(listOfEvents[i].msg.value.type);
    		//console.log(eventTypes.indexOf(listOfEvents[i].msg.value.type) > -1);
    		acc = acc && (eventTypes.indexOf(listOfEvents[i].msg.value.type) > -1);
    	}
    	return acc;
    	/*
    	return (_.reduce(listOfEvents, function(acc, event) {
    		return (acc && event.msg.value.type in eventTypes);
  		}, true));
  		*/
    },
    clearEvents: function _clearEvents() {
      this.loadedScriptId = null;
      this.events = [];
      this.interpretedEvents = [];
      this.eventsToSend = [];
      this.comments = [];
      this.panel.clearEvents();

      this.ports.sendToAll({type: 'reset', value: null});
    },
    getEvents: function _getEvents() {
      return this.events.slice(0);
    },
    getInterpretedEvents: function _getInterpretedEvents() {
      return this.interpretedEvents.slice(0);
    },
    getEventsToSend: function _getEventsToSend() {
      return this.eventsToSend.slice(0);
    },
    getReplayEvents: function _getReplayEvents() {
      return this.replayEvents.slice(0);
    },
    getComments: function _getComments() {
      return this.comments.slice(0);
    },
    getReplayComments: function _getReplayComments() {
      return this.replayComments.slice(0);
    },
    setEvents: function _setEvents(events) {
      this.loadedScriptId = null;
      this.events = events;
      this.comments = [];
      this.panel.clearEvents();
      for (var i = 0, ii = events.length; i < ii; ++i) {
        this.panel.addEvent(events[i]);
      }
    },
    setLoadedScriptId: function _setLoadedScriptId(id) {
      this.loadedScriptId = id;
    },
    getLoadedScriptId: function _getLoadedScriptId() {
      return this.loadedScriptId;
    }
  };

  return Record;
})();

var Replay = (function ReplayClosure() {
  var replayLog = getLog('replay');

  function Replay(events, panel, ports, record, scriptServer) {
    this.panel = panel;
    this.events = events;
    this.ports = ports;
    this.timeoutHandle = null;
    this.record = record;
    this.scriptServer = scriptServer;
    this.ackVar = null;

    // replay variables
    this.reset();
  }

  var ReplayState = {
    REPLAYING: 1,
    REPLAY_ACK: 2,
    WAIT_ACK: 3
  };

  Replay.prototype = {
    replay: function _replay() {
      replayLog.log('starting replay');
      this.pause();
      this.record.startReplayRecording();

      var replay = this;
      replay.guts();
    },
    reset: function _reset() {
      this.index = 0;
      this.portMapping = {};
      this.tabMapping = {};
      this.replayState = ReplayState.REPLAYING;
    },
    setNextEvent: function _setNextEvent(time) {
      if (typeof time == 'undefined') {
        time = 0;
      }

      var replay = this;
      this.timeoutHandle = setTimeout(function() {
        replay.guts();
      }, time);
    },
    getNextTime: function _getNextTime() {
      var timing = params.timing;
      var index = this.index;
      var events = this.events;
      var waitTime = 0;

      if (index == 0 || index == events.length) {
        waitTime = 1000;
      } else if (timing == 0) {
        waitTime = events[index].waitTime;
        if (waitTime > 10000)
          waitTime = 10000;
      } else {
        waitTime = timing;
      }
      replayLog.log('wait time:', waitTime);
      return waitTime;
    },
    pause: function _pause() {
      var handle = this.timeoutHandle;
      if (handle) {
        clearTimeout(handle);
        this.timeoutHandle = null;
      }
    },
    restart: function _restart() {
      if (this.timeoutHandle == null) {
        this.setNextEvent(0);
      }
    },
    skip: function _skip() {
      this.index++;
      this.replayState = ReplayState.REPLAYING;
    },
    resend: function _resend() {
      if (this.replayState == ReplayState.REPLAY_ACK) {
        this.replayState = ReplayState.REPLAYING;
      }
    },
    finish: function _finish() {
      replayLog.log('finishing replay');
      var record = this.record;
      var scriptServer = this.scriptServer;
      setTimeout(function() {
        var replayEvents = record.getReplayEvents();
        var comments = record.getReplayComments();
        var scriptId = record.getLoadedScriptId();

        record.stopReplayRecording();

        if (scriptId && replayEvents.length > 0) {
          scriptServer.saveScript("replay", replayEvents, comments, scriptId);
          replayLog.log('saving replay:', replayEvents);
        }
      }, 1000);
    },
    findPortInTab: function _findPortInTab(tab, topFrame,
        snapshot, msg) {

      var ports = this.ports;
      var newTabId = this.tabMapping[tab];
      var portInfo = ports.getTabInfo(newTabId);
      console.log(msg);
      replayLog.log('trying to find port in tab:');

      if (!portInfo) {
        return;
      }
      var newPort = null;
      if (topFrame) {
        var topFrame = portInfo.top;
        //msg has to have value
        var commonUrl = lcs(topFrame.URL, msg.value.URL);

        var commonRatio = commonUrl.length / msg.value.URL.length;
        if (commonRatio > .8)
          newPort = ports.getPort(topFrame.portName);
      } else {
        replayLog.log('try to find port in one of the iframes');
        var frames = portInfo.frames;
        var urlFrames = [];
        for (var i = 0, ii = frames.length; i < ii; i++) {
          if (frames[i].URL == msg.value.URL) {
            urlFrames.push(frames[i]);
          }
        }

        var allFrameSnapshots = true;
        for (var i = 0, ii = urlFrames.length; i < ii; i++) {
          if (!ports.getSnapshot(urlFrames[i].portName)) {
            allFrameSnapshots = false;
            break;
          }
        }

        if (allFrameSnapshots) {
          var similar = function(node1, node2) {
            if (typeof node1 != 'object' || typeof node2 != 'object') {
              return 0;
            }
            var score = 0;
            var attr1 = node1.attr;
            var attr2 = node2.attr;
            for (var a in attr1) {
              if (a in attr2) {
                score++;
              }
            }

            var children1 = node1.children;
            var children2 = node2.children;
            var c1length = children1.length;
            var c2length = children2.length;
            if (c1length < c2length) {
              var length = c1length;
            } else {
              var length = c2length;
            }
            for (var i = 0; i < length; ++i) {
              score += similar(children1[i], children2[i]);
            }
            return score;
          };
          var topScore = -1;
          var index = -1;
          for (var i = 0, ii = urlFrames.length; i < ii; ++i) {
            var score = similar(snapshot,
                                ports.getSnapshot(urlFrames[i].portName));
            if (score > topScore) {
              index = i;
              topScore = score;
            }
          }
          newPort = ports[urlFrames[index].portName];
          portToSnapshot = {};
        } else {
          for (var i = 0, ii = urlFrames.length; i < ii; i++) {
            var port = ports.getPort(urlFrames[i].portName);
            port.postMessage({type: 'snapshot', value: null});
          }
        }
      }
      replayLog.log('found port:', newPort);
      return newPort;
    },
    guts: function _guts() {
      var eventsToSend = this.events;
      var index = this.index;
      var portMapping = this.portMapping;
      var tabMapping = this.tabMapping;

      if (index >= eventsToSend.length) {
        this.finish();
        return;
      }

      var e = eventsToSend[index];
      var port = e.port;
      var tab = e.tab;
      var id = e.id;
      var url = e.topURL;
      var topFrame = e.topFrame;
      var iframeIndex = e.iframeIndex;
      var target = e.target;
      var snapshot = e.snapshot;
      var msg = e.msg;

      $('#status').text('Replay ' + index + " "+ e.type);
      //$('#' + id).get(0).scrollIntoView();
      //$("#container").scrollTop($("#" + e.id).prop("offsetTop"));

      // lets find the corresponding port
      var replayPort = null;
      // we have already seen this port, reuse existing mapping
      if (port in portMapping) {
        replayPort = portMapping[port];
        replayLog.log('port already seen', replayPort);

      // we have already seen this tab, find equivalent port for tab
      // for now we will just choose the last port added from this tab
      } else if (tab in tabMapping) {
        var newPort = this.findPortInTab(tab, topFrame, snapshot, e.msg);

        if (newPort) {
          portMapping[port] = newPort;
          replayPort = newPort;
          replayLog.log('tab already seen, found port:', replayPort);
        } else {
          this.setNextEvent();
          replayLog.log('tab already seen, no port found');
          return;
        }

      // need to open new tab
      } else {
        var replay = this;
        replayLog.log('need to open new tab');
        chrome.tabs.create({url: url, active: true},
          function(newTab) {
            replayLog.log('new tab opened:', newTab);
            var newTabId = newTab.id;
            replay.tabMapping[tab] = newTabId;
            replay.ports.tabIdToTab[newTabId] = newTab;
            replay.setNextEvent(4000);
          }
        );
        return;
      }

      // we have hopefully found a matching port, lets dispatch to that port
      var type = msg.type;
      var replayState = this.replayState;

      if (replayState == ReplayState.WAIT_ACK) {
        var ackReturn = this.ports.getAck(this.ackVar);
        if (ackReturn != null && ackReturn == true) {
          this.replayState = ReplayState.REPLAYING;
          this.setNextEvent(0);
          e["checkedWait"] = true;

          replayLog.log('found wait ack');
        } else {
          replayPort.postMessage({type:"wait",target:e.target});
          this.setNextEvent(1000);

          replayLog.log('continue waiting for wait ack');
        }
      } else if (replayState == ReplayState.REPLAY_ACK) {
        var ackReturn = this.ports.getAck(this.ackVar);
        if (ackReturn != null && ackReturn == true) {
          this.replayState = ReplayState.REPLAYING;
          this.setNextEvent(0);

          replayLog.log('found replay ack');
        } else {
          this.setNextEvent(1000);

          replayLog.log('continue waiting for replay ack');
        }
      } else if (replayState == ReplayState.REPLAYING) {
        this.ports.clearAck();
        //TODO: not sure when this would actually happen.  want to make sure we're actually waiting when needed
        if (!("checkedWait" in e)) {
          replayPort.postMessage({type:"wait",target:e.target});
          this.replayState = ReplayState.WAIT_ACK;
          this.setNextEvent(0);

          replayLog.log('start waiting for wait ack');
        } else {
          // send message
          try {
            replayPort.postMessage(msg);
            replayLog.log('sent message', msg);

            this.index++;
            this.replayState = ReplayState.REPLAY_ACK;

            replayLog.log('start waiting for replay ack');
          } catch (err) {
            replayLog.log('ERROR:', err.message, err);
          }
          this.setNextEvent();
        }
      } else {
        throw 'unknown replay state';
      }
    }
  };

  return Replay;
})();


var SimultaneousReplay = (function SimultaneousReplayClosure() {
  function SimultaneousReplay(events, panels, ports) {
    Replay.call(this, events, panels, ports);
    this.twinWindow = null;
    this.portToTwinPortMapping = {};
    this.tabToTwinTabMapping = {};
  }

  SimultaneousReplay.prototype = Object.create(Replay.prototype);
  var prototype = SimultaneousReplay.prototype;

  prototype.simultaneousReplay = function _simultaneousReplay(e) {
    var recordReplay = this;
    this.timeoutHandle = setTimeout(function() {
      recordReplay.simultaneousReplayGuts(e);
    }, 0);
  };

  //this function should find the tab that corresponds to the tab
  //in which the event was originally played
  prototype.simultaneousReplayGuts = function _simultaneousReplayGuts(e) {
    var port = e.port;
    var tab = e.tab;
    var replay = this;
    var msg = e.msg;

    var desiredPort = this.portToTwinPortMapping[port];
    var desiredTab = this.tabToTwinTabMapping[tab];
    //we've already found an appropriate twin port, stored in mapping
    if (desiredPort) {
      try {
        desiredPort.postMessage(msg);
      } catch (err) {
        console.log(err.message);
      }
    }
    //no twin port yet, but we have a twin tab
    else if (desiredTab) {
      var newPort = this.findPortInTab(desiredTab, e.topFrame,
                                             e.snapshot, e.msg);
      if (newPort) {
        this.portToTwinPortMapping[port] = newPort;
        newPort.postMessage(msg);
      } else {
        var replay = this;
        this.timeoutHandle = setTimeout(function() {
          replay.simultaneousReplayGuts(e);
        }, this.getNextTime());
      }
    }
    //we haven't made a tab to correspond to the source tab
    //make one now...as long as we're not already in the process of
    //making a tab
    else {
      if (!this.makingTab) {
        //prevent other events from making a new tab while one is
        //already being made, in case they want to make the same
        //tab
        this.makingTab = true;
        chrome.tabs.create({windowId: this.twinWindow, url: e.topURL,
                           active: true},
          function(newTab) {
            var newTabId = newTab.id;
            replay.tabToTwinTabMapping[tab] = newTab;
            replay.tabMapping[newTab] = newTabId;
            replay.ports.tabIdToTab[newTabId] = newTab;
            replay.makingTab = false;
            replay.timeoutHandle = setTimeout(function() {
              replay.simultaneousReplayGuts(e);
            }, 1000);
          }
        );
      }
      else {
        var replay = this;
        this.timeoutHandle = setTimeout(
          function() {
            //a tab is being made.  let's come back around soon
            replay.simultaneousReplayGuts(e);
          }, this.getNextTime());
      }
    }
  };
  return SimultaneousReplay;
})();

// Utility functions

var Controller = (function ControllerClosure() {
  var ctlLog = getLog('controllerLog');

  function Controller(record, scriptServer, ports) {
    this.record = record;
    this.scriptServer = scriptServer;
    this.ports = ports;
  }

  Controller.prototype = {
    setPanel: function(panel) {
      this.panel = panel;
      ctlLog.log("setting the controller's panel");
    },
    // The user started recording
    start: function() {
      ctlLog.log('start');
      if (params.simultaneous) {
        //make the window in which we will simulataneously replay events
        var panel = this.panel;
        var record = this.record;
        chrome.windows.create({},
          function(newWin) {
            //let the panel know which events it shoudn't record
            panel.twinWindow = newWin.id;
            //let replay know where to simultaneously replay
            record.simultaneousReplayer.twinWindow = newWin.id;
            //start record
            record.startRecording();

            // Update the UI
            chrome.browserAction.setBadgeBackgroundColor(
                {color: [255, 0, 0, 64]});
            chrome.browserAction.setBadgeText({text: 'ON'});
          }
        );
      }
      else {
        this.record.startRecording();

        // Update the UI
        chrome.browserAction.setBadgeBackgroundColor({color: [255, 0, 0, 64]});
        chrome.browserAction.setBadgeText({text: 'ON'});
      }
    },
    stop: function() {
      ctlLog.log('stop');
      this.record.stopRecording();
      this.record.newInterpretedEvent(); //take care of the last remaining recent events

      // Update the UI
      chrome.browserAction.setBadgeBackgroundColor({color: [0, 0, 0, 0]});
      chrome.browserAction.setBadgeText({text: 'OFF'});
    },
    reset: function() {
      ctlLog.log('reset');
      this.record.clearEvents();
    },
    replayScript: function() {
      ctlLog.log('replay');
      this.stop();

      var record = this.record;
      var events = record.getEvents();
      var eventsToSend = record.getEventsToSend();
      var replay = new Replay(eventsToSend, this.panel, this.ports, record,
                              this.scriptServer);
      this.replay = replay;
      replay.replay();
    },
    pause: function() {
      this.replay.pause();
    },
    restart: function() {
      this.replay.restart();
    },
    skip: function() {
      this.replay.skip();
    },
    resend: function() {
      this.replay.resend();
    },
    saveScript: function(name) {
      ctlLog.log('saving script');
      var events = this.record.getEvents();
      var comments = this.record.getComments();
      this.scriptServer.saveScript(name, events, comments);
    },
    getScript: function(name) {
      ctlLog.log('getting script');
      var controller = this;
      var events = this.scriptServer.getScript(name,
          function(scriptId, events) {
            controller.setLoadedEvents(scriptId, events);
          });
    },
    setLoadedEvents: function(scriptId, events) {
      this.record.setEvents(events);
      this.record.setLoadedScriptId(scriptId);
    }
  };

  return Controller;
})();

// Instantiate components
var ports = new PortManager();
var record = new Record(ports);
//var scriptServer = new ScriptServer("http://localhost:8000/api/");
//var scriptServer = new ScriptServer("http://webscriptdb.herokuapp.com/api/");
var scriptServer = new ScriptServer(params.server);
var controller = new Controller(record, scriptServer, ports);
var panel = new Panel(controller, ports);

controller.setPanel(panel);
record.setPanel(panel);

var simultaneousReplayer = new SimultaneousReplay([], panel, ports);
record.setSimultaneousReplayer(simultaneousReplayer);

// Add event handlers

var bgLog = getLog('background');
// The first message content scripts send is to get a unique id
function handleIdMessage(request, sender, sendResponse) {
  bgLog.log('background receiving:', request, 'from', sender);
  if (request.type == 'getId') {
    var portName = ports.getNewId(request.value, sender);
    sendResponse({type: 'id', value: portName});
  }
}

// Route messages from the ports
var handleMessage = function(port, request) {
  if (request.type == 'event') {
    record.addEvent(request, port.name);
  } else if (request.type == 'updateEvent') {
    record.updateEvent(request, port.name);
  } else if (request.type == 'comment') {
    record.addComment(request, port.name);
  } else if (request.type == 'getRecording') {
    port.postMessage({type: 'recording', value: record.getStatus()});
  } else if (request.type == 'getParams') {
    port.postMessage({type: 'params', value: params});
  } else if (request.type == 'snapshot') {
    ports.addSnapshot(port.name, request.value);
  } else if (request.type == 'ack') {
    ports.setAck(request.value);
    bgLog.log('got ack');
  } else if (request.type == 'url') {
    ports.updateUrl(port, request.value);
  }
};


// Attach the event handlers to their respective events
chrome.extension.onMessage.addListener(handleIdMessage);

chrome.extension.onConnect.addListener(function(port) {
  ports.connectPort(port);
});

// window is closed so tell the content scripts to stop recording and reset the
// extension icon
$(window).unload(function() {
  controller.stop();
  chrome.browserAction.setBadgeText({text: ''});
  chrome.extension.onMessage.removeListener(handleMessage);
});

ports.sendToAll({type: 'params', value: params});
controller.stop();
