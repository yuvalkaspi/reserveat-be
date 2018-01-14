// The Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers.
const functions = require('firebase-functions');

// The Firebase Admin SDK to access the Firebase Realtime Database. 
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

const moment = require('moment');

const dateFormat = "YYYY/MM/DD HH:mm";
const dateFormatUser = "DD/MM/YYYY HH:mm";
const flexibleHourDiff = 2;
const warmResHotness = [7];
const hotResHotness = [7,8];
const boiligHotResHotness = [7,8,9,10];




/*
Sends notification to user which reservation that he published was picked
*/
exports.notifyOnPickedReservation = functions.database.ref('/users/{uid}/pickedReservations/{pushId}')
    .onCreate(event => {
        const reservation = event.data.val();
        const userId = reservation.uid;
        const restaurant = reservation.restaurant;

        const title = "Your reservation to " + restaurant + " has been picked";
        const body = "You earned 2 stars!";
   
        return sendNotification(userId, createPayload(title, body, {}))
            	.then(results => {
                    console.log("notifyOnPickedReservation Successfully finished");
                })
                .catch(error => {
                    console.log("notifyOnPickedReservation finished with error:", error);
                });
    });


/*
Spam handle Sends notification to user which was reported spammer
*/
exports.notifyOnReportedSpammer = functions.database.ref('/users/{uid}/spamReports')
    .onWrite(event => {
        const userId = event.params.uid;
        const numOfReports = event.data.val();
        const title = "Your reservation was reported as spam" ;
        let body;

		switch (numOfReports) {
		    case 1:
		        body = "warning: next time your stars will be lost";
		        break;
		    case 2:
		        body = "warning: next time you will be blocked";
		        admin.database().ref('/users/' + userId + '/stars').set(0);
		        admin.database().ref("/users/" + userId + "/starRemoveDate").set(null);
		        break;
		    case 3:
		        body = "You are blocked from our app";
				admin.auth().updateUser(userId,{
			  		disabled: true
				})
				admin.auth()
		        break;
		}
   
        return sendNotification(userId, createPayload(title, body, {}))
            	.then(results => {
                    console.log("notifyOnReportedSpammer Successfully finished");
                })
                .catch(error => {
                    console.log("notifyOnReportedSpammer finished with error:", error);
                });
    });




exports.updateReservationHottnessRate = functions.database.ref('/reviews/{placeId}/{day}/{timeOfDay}/hottnesRate').onWrite( event => { 
	
	const resPlaceId = event.params.placeId;
  	const resDay = event.params.day;
  	const resTimeOfDay = event.params.timeOfDay;
  	const hottnessRate = event.data.val();
  	const promises = [];
  	console.log("start updateReservationHottnessRate hottnessRate:", hottnessRate);

  	return admin.database().ref("/reservations").orderByChild("placeId").equalTo(resPlaceId)
  												.once('value').then(snapshot => {
  		snapshot.forEach(reservation => {
  			var currResDay = reservation.child("day").val();
  			var currResTimeOfDay = reservation.child("timeOfDay").val();
  			if(resDay == currResDay && resTimeOfDay == currResTimeOfDay ){
	     		promises.push(admin.database().ref('/reservations/' + reservation.key +  '/hotness' ).set(hottnessRate));
	     		console.log("updateReservationHottnessRate new hottnessRate for:", reservation.key);
     		}
     	});

     	return Promise.all(promises);
	});
});



exports.calculateHottnessRate = functions.database.ref('/reviews/{placeId}/{day}/{timeOfDay}/{pushId}').onCreate( event => { 
	const resPlaceId = event.params.placeId;
	const promises = [];
  	const resDay = event.params.day;
  	const resTimeOfDay = event.params.timeOfDay;
  	let hottnessRate = 0;
  	let sumOfReliability = 0;
  	return admin.database().ref("/reviews/" + "/" + resPlaceId + "/" + resDay + "/" + resTimeOfDay).orderByKey().once('value').then(snapshot => {

  		snapshot.forEach(review => {
     		var userId = review.child("userId").val();
     		var userRef = admin.database().ref("/users/" + userId + "/reliability");
     		let reliability = 0
     		return userRef.orderByKey().once('value').then(snapshot => {
     			
     			reliability = snapshot.val();
     			var busyRate = review.child("busyRate").val();
      			var rate =review.child("rate").val();

      			hottnessRate += (reliability / 20) * ((0.6 * busyRate) + (0.4 * rate));
      			sumOfReliability += (reliability / 20);
   	    		hottnessRate = hottnessRate / sumOfReliability;
  				promises.push(admin.database().ref('/reviews/' + resPlaceId +  '/' + resDay + '/' + resTimeOfDay +  '/' + "hottnesRate").set(hottnessRate));
  				console.log("push hottnessRate: " + hottnessRate + "for: " + "/reviews/" + resPlaceId +  '/' + resDay + '/' + resTimeOfDay);
     		});

     	});

     	return Promise.all(promises);
	});
});



/*
When a new reservation is published-
sends notification to user if there is a match
*/
exports.notifyOnNewMatch = functions.database.ref('/reservations/{pushId}')
    .onCreate(event => {
        const reservation = event.data.val();
		const notificationsPromises = [];
       	const title = "New reservation matching your request was arrived";

        return admin.database().ref('/notificationRequests')
    			.orderByChild('numOfPeople')
    			.equalTo(reservation.numOfPeople)
    			.once('value')
    			.then(snapshot => {
    				snapshot.forEach(notificationReqSnap => {
  						notificationsPromises.push(matchedNotification(reservation, event.params.pushId, notificationReqSnap.val(), title));
					});
					return Promise.all(notificationsPromises)
				})
				.then(results => {
                    console.log("notifyOnNewMatch Successfully finished");
                })
                .catch(error => {
                    console.log("notifyOnNewMatch finished with error:", error);
                });

    });


/*
When a new notification request is published-
sends notification to user if there is a match
*/
exports.notifyOnExistsMatch = functions.database.ref('/notificationRequests/{pushId}')
    .onCreate(event => {

        const notificationReq = event.data.val();
		const notificationsPromises = [];
       	const title = "Reservation matching your request is exists";

        return admin.database().ref('/reservations')
    			.orderByChild('numOfPeople')
    			.equalTo(notificationReq.numOfPeople)
    			.once('value')
    			.then(snapshot => {
    				snapshot.forEach(reservationSnap => {
  						notificationsPromises.push(matchedNotification(reservationSnap.val(), reservationSnap.key, notificationReq, title));
					});
					return Promise.all(notificationsPromises)
				})
				.then(results => {
                    console.log("notifyOnExistsMatch Successfully finished");
                })
                .catch(error => {
                    console.log("notifyOnExistsMatch finished with error:", error);
                });

    });


/*
If no one picked a reservation (the date field is 2 hours or less from current time),
sends a notification and move it to history
Running every 15 minutes
*/
exports.notifyAndMoveToHistoryReservationsCron = functions.https.onRequest((req,res) => {
	const latestDateToNotify = moment().add(4,'hours').format(dateFormat); //2 hours difference between server to local time
	const notificationPromises = [];
	
	return admin.database().ref('/reservations')
    			.orderByChild('date')
    			.endAt(latestDateToNotify)
    			.once('value')
    			.then(snapshot => {
    				snapshot.forEach(reservationSnap => {
    					const reservation = reservationSnap.val();

            			const title = "Your reservation to " + reservation.restaurant + " Didn't picked";
        				const body = "Don't forget to notify the restaurant you will not arrive";

  						notificationPromises.push(sendNotification(reservation.uid, createPayload(title, body, {})));
					});
					console.log("Send notifications...");
					return Promise.all(notificationPromises)
				})
				.then(results => {
					return moveOldItemsToHistory('/reservations', '/historyReservations', latestDateToNotify);
                })
				.then(results => {
					res.send('OK');
                    console.log("notifyAndMoveToHistoryCron Successfully finished");
                })
                .catch(error => {
                	res.send(error);
                    console.log("notifyAndMoveToHistoryCron finished with error:", error);
                });
});



/*
Move to history notification requests
Running once a day
*/
exports.moveNotificationRequestsToHistoryCron = functions.https.onRequest((req,res) => {

	const latestDateToMove = moment().add(2,'hours').subtract(flexibleHourDiff,'hours').format(dateFormat); //2 hours difference between server to local time
	const promises = [];
	console.log("Moving to history notification requests before: ", latestDateToMove);

	return moveOldItemsToHistory('/notificationRequests', 'historyNotificationRequests', latestDateToMove)
				.then(results => {
					res.send('OK');
                    console.log("moveNotificationRequestsToHistoryCron Successfully finished");
                })
                .catch(error => {
                	res.send(error);
                    console.log("moveNotificationRequestsToHistoryCron finished with error:", error);
                });
});


/*
zero number of uploads this month
Running once a mounth
*/
exports.zeroNumOfUploads = functions.https.onRequest((req,res) => {

	const promises = [];
	console.log("Putting zero to uploads: ");

	return admin.database().ref('/users')
    			.once('value')
    			.then(snapshot => {
    				snapshot.forEach(userSnap => {
  						const userId = userSnap.key;
  						promises.push(admin.database().ref('/users/' + userId + '/uploadsThisMonth').set(0));
  					});
					return Promise.all(promises);
				})
				.then(results => {
					res.send('OK');
                    console.log("zeroNumOfUploads finished Successfully");
                })
                .catch(error => {
                	res.send(error);
                    console.log("zeroNumOfUploads finished with error:", error);
                });
});



/*
If latestDateToRemove < current time => decrease num of stars and update latestDateToRemove to month later (if there are more stars)
*/
exports.removeStarsCron = functions.https.onRequest((req,res) => {

	const latestDateToRemove = moment().add(2,'hours').format(dateFormat); //2 hours difference between server to local time
	const promises = [];

	return admin.database().ref('/users')
    			.orderByChild('starRemoveDate')
    			.endAt(latestDateToRemove)
    			.once('value')
    			.then(snapshot => {
    				snapshot.forEach(userSnap => {
  						const user = userSnap.val();
  						const numOfStars = user.stars;
  						const userId = userSnap.key;
  						if(numOfStars > 0){
  							if(numOfStars == 1){
								promises.push(admin.database().ref('/users/' + userId + '/starRemoveDate').set(null));
  							}
  							else{
  								const updatedRemoveStarDate = moment(user.starRemoveDate, dateFormat).add(1,'months').format(dateFormat);
  								promises.push(admin.database().ref('/users/' + userId + '/starRemoveDate').set(updatedRemoveStarDate));
  							}
  							promises.push(admin.database().ref('/users/' + userId + '/stars').set(numOfStars-1));
  						}
  					});
  					console.log("Num of users that lost a star: ", promises.length/2);
					return Promise.all(promises);
				})
				.then(results => {
					res.send('OK');
                    console.log("removeStarsCron Successfully finished");
                })
                .catch(error => {
                	res.send(error);
                    console.log("removeStarsCron finished with error:", error);
                });
});


/*
Sends notifications to users with stars upon arrival of hot reservations
*/
exports.notifyHotReservations = functions.database.ref('/reservations/{pushId}')
    .onCreate(event => {
        const reservation = event.data.val();

        if (boiligHotResHotness.indexOf(reservation.hotness) > -1){

        	const title = "Hot reservation was arrived!";
        	const dateUser = moment(reservation.date, dateFormat).format(dateFormatUser);
        	const body = "Reservation to " + reservation.restaurant + " at " + dateUser;
        	const data = {
                reservationId: event.params.pushId
       		};
            const payload = createPayload(title, body, data);
        	
        	const warmReservations = [];
			const hotReservations = [];
			const boiligHotReservations = [];

			boiligHotReservations.push(payload);

			if (hotResHotness.indexOf(reservation.hotness) > -1){
				hotReservations.push(payload);

				if (warmResHotness.indexOf(reservation.hotness) > -1){
					warmReservations.push(payload);
				}
			}

			return hotReservationsNotification(warmReservations, hotReservations, boiligHotReservations)
				.then(results => {
                    console.log("notifyHotReservations Successfully finished");
                })
                .catch(error => {
                    console.log("notifyHotReservations finished with error:", error);
                });
        }

        return Promise.resolve("notifyHotReservations Successfully finished");
        
    });



const hotReservationsNotification = (warmReservations, hotReservations, boiligHotReservations) => {

	const notificationPromises = [];

	return admin.database().ref('/users')
    			.orderByChild('stars')
    			.startAt(1)
    			.once('value')
    			.then(snapshot => {
    				snapshot.forEach(userSnap => {
  						const user = userSnap.val();
  						const userId = userSnap.key;
  						if(user.stars == 1){
  							warmReservations.forEach(payload => {
  								notificationPromises.push(sendNotification(userId, payload))
  							});
  						}
  						if(user.stars == 2){
  							hotReservations.forEach(payload => {
  								notificationPromises.push(sendNotification(userId, payload))
  							});
  						}
  						if(user.stars == 3){
  							boiligHotReservations.forEach(payload => {
  								notificationPromises.push(sendNotification(userId, payload))
  							});
  						}
  					});
					return Promise.all(notificationPromises);
				})	
};


const matchedNotification = (reservation, reservationKey, notificationReq, titleStr) => {

   	let dateMatch = reservation.date == notificationReq.date || notificationReq.date == "";
  	if(notificationReq.isFlexible && !dateMatch) {
		const dateReservation = moment(reservation.date, dateFormat);
		const minDateStr = dateReservation.clone().subtract(flexibleHourDiff,'hours').format(dateFormat);
		const maxDateStr = dateReservation.clone().add(flexibleHourDiff,'hours').format(dateFormat);
  		dateMatch = notificationReq.date > minDateStr && notificationReq.date < maxDateStr;
  	}

  	const restaurantMatch = reservation.restaurant == notificationReq.restaurant || notificationReq.restaurant == "";
  	const branchMatch = reservation.branch == notificationReq.branch || notificationReq.branch == "";
  	const result = dateMatch && restaurantMatch && branchMatch;
  	if(result){
  		console.log("found a match , notification request of userId: " + notificationReq.id);
  		const title = titleStr;
  		const dateUser = moment(reservation.date, dateFormat).format(dateFormatUser);
   		const body = "Reservation to " + reservation.restaurant + " at " + dateUser;
    	const data = {
    		reservationId: reservationKey
    	};
  		return sendNotification(notificationReq.uid, createPayload(title, body, data));
  	}
  	return Promise.resolve();
};


const moveOldItemsToHistory = (refToRemove, refToAdd, latestDateToMove) => {

	const promises = [];

	return admin.database().ref(refToRemove)
    			.orderByChild('date')
    			.endAt(latestDateToMove)
    			.once('value')
    			.then(snapshot => {
    				snapshot.forEach(itemSnap => {
    					const item = itemSnap.val();
    					if(item.date != ""){
    						const key = itemSnap.key;
  							promises.push(admin.database().ref(refToRemove + '/' + key).set(null));
  							promises.push(admin.database().ref(refToAdd + '/' + key).set(item));
    					}
  					});
  					console.log("Num of items moving to history: ", promises.length/2);
					return Promise.all(promises);
				})	
};


const sendNotification = (userId, payload) => {

	return admin.database().ref(`/users/${userId}/instanceId`)
        		.once('value')
        		.then(result => {
            		const instanceId = result.val();
            		return admin.messaging().sendToDevice(instanceId, payload);
            	})
};


const createPayload = (titleStr, bodyStr, dataObj) => {

	const payload = {};
	payload['notification'] = {
		title: titleStr,
		body: bodyStr
	}
	payload['data'] = dataObj;
	return payload;
};



